import ExpoModulesCore
import UIKit

private final class MessageCollectionView: UICollectionView {
  var didLayout: (() -> Void)?

  override func layoutSubviews() {
    super.layoutSubviews()
    didLayout?()
  }
}

final class NativeMessageList: ExpoView, UICollectionViewDelegate {
  let onReachTop = EventDispatcher()
  var emptyTitle = "" { didSet { updateEmptyState() } }
  var emptyBody = "" { didSet { updateEmptyState() } }

  private let collection: MessageCollectionView
  private let bottomButton = UIButton(type: .system)
  private let emptyLabel = UILabel()
  private var source: UICollectionViewDiffableDataSource<Int, TranscriptRow.ID>!
  private var rows: [TranscriptRow.ID: TranscriptRow] = [:]
  private var following = true
  private var applying = false
  private var decoding = false
  private var reachedTop = false
  private var pendingJSON: String?
  private var updateScheduled = false
  private var lastSize = CGSize.zero
  private var decodeFailed = false

  required init(appContext: AppContext? = nil) {
    let layout = UICollectionViewCompositionalLayout { _, _ in
      let size = NSCollectionLayoutSize(widthDimension: .fractionalWidth(1), heightDimension: .estimated(80))
      let item = NSCollectionLayoutItem(layoutSize: size)
      let group = NSCollectionLayoutGroup.vertical(layoutSize: size, subitems: [item])
      let section = NSCollectionLayoutSection(group: group)
      section.interGroupSpacing = 12
      section.contentInsets = .init(top: 16, leading: 16, bottom: 16, trailing: 16)
      return section
    }
    collection = MessageCollectionView(frame: .zero, collectionViewLayout: layout)
    super.init(appContext: appContext)
    backgroundColor = .systemBackground
    collection.backgroundColor = .systemBackground
    collection.delegate = self
    collection.alwaysBounceVertical = true
    collection.keyboardDismissMode = .interactive
    collection.accessibilityIdentifier = "native-message-list"
    collection.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(collection)

    let classes: [BlockKind: MessageBlockCell.Type] = [
      .text: TextMessageCell.self, .reasoning: ReasoningMessageCell.self,
      .tool: ToolMessageCell.self, .error: ErrorMessageCell.self,
      .notice: NoticeMessageCell.self, .attachments: AttachmentsMessageCell.self,
    ]
    for (kind, type) in classes {
      collection.register(type, forCellWithReuseIdentifier: kind.rawValue)
    }
    source = UICollectionViewDiffableDataSource<Int, TranscriptRow.ID>(collectionView: collection) {
      [weak self] collection, path, id in
      guard let row = self?.rows[id] else { return nil }
      let cell = collection.dequeueReusableCell(withReuseIdentifier: id.kind.rawValue, for: path)
      (cell as? MessageBlockCell)?.configure(row)
      return cell
    }
    emptyLabel.numberOfLines = 0
    emptyLabel.textAlignment = .center
    emptyLabel.font = .preferredFont(forTextStyle: .body)
    emptyLabel.adjustsFontForContentSizeCategory = true
    emptyLabel.textColor = .secondaryLabel
    collection.backgroundView = emptyLabel

    var buttonConfiguration = UIButton.Configuration.tinted()
    buttonConfiguration.image = UIImage(systemName: "arrow.down")
    buttonConfiguration.cornerStyle = .capsule
    bottomButton.configuration = buttonConfiguration
    bottomButton.tintColor = .systemBlue
    bottomButton.accessibilityLabel = MemohStrings.text("Back to bottom")
    bottomButton.accessibilityIdentifier = "messages-back-to-bottom"
    bottomButton.addTarget(self, action: #selector(returnToBottom), for: .touchUpInside)
    bottomButton.translatesAutoresizingMaskIntoConstraints = false
    addSubview(bottomButton)
    NSLayoutConstraint.activate([
      bottomButton.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -16),
      bottomButton.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -12),
      bottomButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
      bottomButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
    ])
    bottomButton.isHidden = true
    collection.didLayout = { [weak self] in
      guard let self, self.following, !self.applying,
            !self.collection.isDragging, !self.collection.isDecelerating else { return }
      // Estimated heights settle over more than one layout pass, especially on first load.
      self.pinBottom()
    }
    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
      (view: NativeMessageList, _: UITraitCollection) in
      view.collection.collectionViewLayout.invalidateLayout()
      view.setNeedsLayout()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    collection.frame = bounds
    if lastSize != bounds.size {
      lastSize = bounds.size
      collection.collectionViewLayout.invalidateLayout()
      collection.layoutIfNeeded()
      if following { pinBottom() }
    }
  }

  // Expo view props are delivered on the UI queue. Collapse bursts before decoding/applying.
  func setTurnsJSON(_ json: String) {
    dispatchPrecondition(condition: .onQueue(.main))
    pendingJSON = json
    scheduleUpdate()
  }

  private func scheduleUpdate() {
    guard !updateScheduled, !applying, !decoding, pendingJSON != nil else { return }
    updateScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0 / 30.0) { [weak self] in
      guard let self else { return }
      self.updateScheduled = false
      guard let json = self.pendingJSON else { return }
      self.pendingJSON = nil
      self.decoding = true
      Task { @MainActor [weak self] in
        let result = await Task.detached(priority: .userInitiated) {
          Result { try TranscriptRow.decode(json) }
        }.value
        guard let self else { return }
        self.decoding = false
        // Publish this completed frame even if newer JSON is waiting; otherwise a busy
        // long transcript could starve rendering indefinitely.
        switch result {
        case .success(let decoded):
          self.decodeFailed = false
          self.apply(decoded)
        case .failure:
          // Keep the last valid transcript; never log potentially private message data.
          self.decodeFailed = true
        }
        self.updateEmptyState()
        self.scheduleUpdate()
      }
    }
  }

  private func apply(_ incoming: [TranscriptRow]) {
    let old = source.snapshot()
    let ids = incoming.map(\.id)
    let next = Dictionary(uniqueKeysWithValues: incoming.map { ($0.id, $0) })
    let changed = ids.filter { rows[$0] != nil && rows[$0] != next[$0] }
    guard old.itemIdentifiers != ids || !changed.isEmpty else { return }
    let anchor = visibleAnchor()
    rows = next
    var snapshot = NSDiffableDataSourceSnapshot<Int, TranscriptRow.ID>()
    snapshot.appendSections([0])
    snapshot.appendItems(ids)
    snapshot.reconfigureItems(changed)
    applying = true
    // No reloadData and no insertion/height animations on streaming updates.
    source.apply(snapshot, animatingDifferences: false) { [weak self] in
      guard let self else { return }
      self.collection.layoutIfNeeded()
      if self.following {
        self.pinBottom()
      } else if let (id, distance) = anchor,
                let path = self.source.indexPath(for: id),
                let frame = self.collection.layoutAttributesForItem(at: path)?.frame {
        // Preserve the actual reading anchor, including history prepends and resized rows above it.
        self.collection.contentOffset.y = frame.minY - distance
      }
      self.applying = false
      self.bottomButton.isHidden = self.following || self.rows.isEmpty
      self.scheduleUpdate()
    }
  }

  private func visibleAnchor() -> (TranscriptRow.ID, CGFloat)? {
    let paths = collection.indexPathsForVisibleItems.sorted()
    for path in paths {
      if let id = source.itemIdentifier(for: path),
         let frame = collection.layoutAttributesForItem(at: path)?.frame {
        return (id, frame.minY - collection.contentOffset.y)
      }
    }
    return nil
  }

  private var bottomOffset: CGFloat {
    max(-collection.adjustedContentInset.top,
        collection.contentSize.height - collection.bounds.height + collection.adjustedContentInset.bottom)
  }

  private func pinBottom(force: Bool = false) {
    guard force || (!collection.isDragging && !collection.isDecelerating) else { return }
    guard abs(collection.contentOffset.y - bottomOffset) > 0.5 else { return }
    collection.setContentOffset(CGPoint(x: 0, y: bottomOffset), animated: false)
  }

  @objc private func returnToBottom() {
    following = true
    pinBottom(force: true)
    bottomButton.isHidden = true
  }

  func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
    // Disengage immediately so a concurrent stream cannot fight the finger.
    following = false
  }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    guard !applying else { return }
    if scrollView.isDragging || scrollView.isDecelerating || scrollView.isTracking {
      following = bottomOffset - scrollView.contentOffset.y <= 24
      bottomButton.isHidden = following || rows.isEmpty
      let atTop = scrollView.contentOffset.y <= -scrollView.adjustedContentInset.top + 44
      if atTop && !reachedTop && !rows.isEmpty { onReachTop([:]) }
      reachedTop = atTop
    }
  }

  private func updateEmptyState() {
    emptyLabel.isHidden = !rows.isEmpty
    if decodeFailed {
      emptyLabel.text = MemohStrings.text("Messages could not be displayed.")
    } else {
      emptyLabel.text = [emptyTitle, emptyBody].filter { !$0.isEmpty }.joined(separator: "\n\n")
    }
  }
}

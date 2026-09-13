import ExpoModulesCore
import UIKit

private final class MessageCollectionView: UICollectionView {
  var didLayout: (() -> Void)?
  var willAccessibilityScroll: (() -> Void)?

  override func layoutSubviews() {
    super.layoutSubviews()
    didLayout?()
  }

  override func accessibilityScroll(_ direction: UIAccessibilityScrollDirection) -> Bool {
    willAccessibilityScroll?()
    return super.accessibilityScroll(direction)
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
  private var expansion = ReasoningExpansionState()
  private var expansionUpdates = Set<TranscriptRow.ID>()
  private var readingAnchor: (TranscriptRow.ID, CGFloat)?
  private var interactionRevision = 0
  private var restoringAnchor = false
  private var pendingRows: [TranscriptRow]?

  required init(appContext: AppContext? = nil) {
    let layout = UICollectionViewCompositionalLayout { _, _ in
      let size = NSCollectionLayoutSize(widthDimension: .fractionalWidth(1), heightDimension: .estimated(80))
      let item = NSCollectionLayoutItem(layoutSize: size)
      let group = NSCollectionLayoutGroup.vertical(layoutSize: size, subitems: [item])
      let section = NSCollectionLayoutSection(group: group)
      section.interGroupSpacing = CGFloat(MessageListMetrics.blockSpacing)
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
      guard let self, let row = self.rows[id] else { return nil }
      let cell = collection.dequeueReusableCell(withReuseIdentifier: id.kind.rawValue, for: path)
      if let reasoning = cell as? ReasoningMessageCell {
        reasoning.configure(row, expanded: self.expansion.isExpanded(id))
        reasoning.onToggle = { [weak self] in self?.toggleReasoning(id) }
      } else {
        (cell as? MessageBlockCell)?.configure(row)
      }
      return cell
    }
    emptyLabel.numberOfLines = 0
    emptyLabel.textAlignment = .center
    emptyLabel.font = .preferredFont(forTextStyle: .body)
    emptyLabel.adjustsFontForContentSizeCategory = true
    emptyLabel.textColor = .secondaryLabel
    collection.backgroundView = emptyLabel

    var buttonConfiguration = UIButton.Configuration.filled()
    buttonConfiguration.baseBackgroundColor = .secondarySystemBackground
    buttonConfiguration.baseForegroundColor = .systemBlue
    buttonConfiguration.image = UIImage(systemName: "arrow.down")
    buttonConfiguration.title = MemohStrings.text("Back to bottom")
    buttonConfiguration.imagePadding = 8
    buttonConfiguration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var result = attributes
      result.font = .preferredFont(forTextStyle: .subheadline)
      return result
    }
    buttonConfiguration.cornerStyle = .capsule
    bottomButton.configuration = buttonConfiguration
    bottomButton.titleLabel?.adjustsFontForContentSizeCategory = true
    bottomButton.titleLabel?.numberOfLines = 0
    bottomButton.tintColor = .systemBlue
    bottomButton.accessibilityLabel = MemohStrings.text("Back to bottom")
    bottomButton.accessibilityIdentifier = "messages-back-to-bottom"
    bottomButton.addTarget(self, action: #selector(returnToBottom), for: .touchUpInside)
    bottomButton.translatesAutoresizingMaskIntoConstraints = false
    addSubview(bottomButton)
    NSLayoutConstraint.activate([
      bottomButton.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -16),
      bottomButton.leadingAnchor.constraint(greaterThanOrEqualTo: safeAreaLayoutGuide.leadingAnchor, constant: 16),
      bottomButton.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -12),
      bottomButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
      bottomButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
    ])
    bottomButton.isHidden = true
    collection.didLayout = { [weak self] in
      guard let self, !self.applying, !self.isInteracting else { return }
      // Estimated heights settle over more than one layout pass, especially on first load.
      if self.following { self.pinBottom() } else { self.restoreReadingAnchor() }
    }
    collection.willAccessibilityScroll = { [weak self] in self?.beginReading() }
    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
      (view: NativeMessageList, _: UITraitCollection) in
      view.collection.collectionViewLayout.invalidateLayout()
      view.bottomButton.setNeedsUpdateConfiguration()
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
    // A decode can finish while a disclosure-triggered snapshot is still applying.
    guard !applying else { pendingRows = incoming; return }
    let old = source.snapshot()
    let ids = incoming.map(\.id)
    let next = Dictionary(uniqueKeysWithValues: incoming.map { ($0.id, $0) })
    expansionUpdates.formIntersection(ids)
    let changed = ids.filter { rows[$0] != nil && (rows[$0] != next[$0] || expansionUpdates.contains($0)) }
    guard old.itemIdentifiers != ids || !changed.isEmpty else { return }
    let anchor = visibleAnchor()
    let revision = interactionRevision
    expansion.retain(ids)
    expansionUpdates.removeAll()
    readingAnchor = nil
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
      } else if MessageListMetrics.canRestoreAnchor(capturedRevision: revision,
                  currentRevision: self.interactionRevision, isInteracting: self.isInteracting) {
        // Never restore an anchor captured before a new user gesture or disclosure action.
        self.readingAnchor = anchor
        self.restoreReadingAnchor()
      }
      self.applying = false
      self.updateBottomButton()
      if let pending = self.pendingRows {
        self.pendingRows = nil
        self.apply(pending)
      } else {
        self.refreshExpansionIfNeeded()
      }
      self.scheduleUpdate()
    }
  }

  private func toggleReasoning(_ id: TranscriptRow.ID) {
    guard rows[id]?.block.kind == .reasoning else { return }
    // Expanding content is an explicit reading action, even if the list was following.
    beginReading()
    expansion.toggle(id)
    expansionUpdates.insert(id)
    refreshExpansionIfNeeded()
  }

  private func refreshExpansionIfNeeded() {
    guard !applying, !expansionUpdates.isEmpty else { return }
    apply(source.snapshot().itemIdentifiers.compactMap { rows[$0] })
  }

  private var isInteracting: Bool {
    collection.isDragging || collection.isDecelerating || collection.isTracking
  }

  private func beginReading() {
    interactionRevision += 1
    following = false
    readingAnchor = nil
    updateBottomButton()
  }

  private func updateBottomButton() {
    bottomButton.isHidden = following || rows.isEmpty
  }

  private func restoreReadingAnchor() {
    guard !restoringAnchor, !isInteracting, let (id, distance) = readingAnchor,
          let path = source.indexPath(for: id),
          let frame = collection.layoutAttributesForItem(at: path)?.frame else { return }
    let offset = CGFloat(MessageListMetrics.anchoredOffset(
      itemTop: Double(frame.minY), distance: Double(distance),
      topInset: Double(collection.adjustedContentInset.top), bottomOffset: Double(bottomOffset)))
    guard abs(collection.contentOffset.y - offset) > 0.5 else { return }
    restoringAnchor = true
    collection.contentOffset.y = offset
    restoringAnchor = false
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
    CGFloat(MessageListMetrics.bottomOffset(
      contentHeight: Double(collection.contentSize.height), viewportHeight: Double(collection.bounds.height),
      topInset: Double(collection.adjustedContentInset.top), bottomInset: Double(collection.adjustedContentInset.bottom)))
  }

  private func pinBottom(force: Bool = false) {
    guard force || !isInteracting else { return }
    guard abs(collection.contentOffset.y - bottomOffset) > 0.5 else { return }
    collection.setContentOffset(CGPoint(x: 0, y: bottomOffset), animated: false)
  }

  @objc private func returnToBottom() {
    interactionRevision += 1
    readingAnchor = nil
    following = true
    pinBottom(force: true)
    bottomButton.isHidden = true
  }

  func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
    // Disengage immediately so a concurrent stream cannot fight the finger.
    beginReading()
  }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    if scrollView.isDragging || scrollView.isDecelerating || scrollView.isTracking {
      // Also process gestures during a diffable update; don't re-engage mid-gesture.
      beginReading()
      let atTop = scrollView.contentOffset.y <= -scrollView.adjustedContentInset.top + 44
      if atTop && !reachedTop && !rows.isEmpty { onReachTop([:]) }
      reachedTop = atTop
    }
  }

  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
    if !decelerate { finishReadingGesture() }
  }

  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { finishReadingGesture() }

  func scrollViewShouldScrollToTop(_ scrollView: UIScrollView) -> Bool {
    beginReading()
    return true
  }

  private func finishReadingGesture() {
    interactionRevision += 1
    following = MessageListMetrics.isNearBottom(offset: Double(collection.contentOffset.y), bottomOffset: Double(bottomOffset))
    readingAnchor = following ? nil : visibleAnchor()
    updateBottomButton()
    if following && !applying { pinBottom() }
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

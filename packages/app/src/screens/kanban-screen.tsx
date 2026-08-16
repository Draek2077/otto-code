import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Check,
  ExternalLink,
  ListChevronsUpDown,
  MoreVertical,
  Plus,
  RefreshCw,
  type IconComponent,
} from "@/components/icons/material-icons";
import { useKanbanBoard } from "@/kanban/kanban-hooks";
import type { KanbanBoardRef, KanbanCard, KanbanColumn } from "@otto-code/protocol/kanban";
import { resolveKanbanScreenBodyState, type KanbanScreenBodyState } from "./kanban-screen-state";

// ── Shared types ────────────────────────────────────────────────────────────

/**
 * Structural layout-event type (matches the context-menu / dropdown-menu
 * handlers): the runtime event carries `nativeEvent.layout`.
 */
interface LayoutEvent {
  nativeEvent: {
    layout: { x: number; y: number; width: number; height: number };
  };
}

type KanbanProviderId = "memory" | "github";

const PROVIDER_OPTIONS: readonly KanbanProviderId[] = ["memory", "github"];

function providerLabel(providerId: KanbanProviderId): string {
  return providerId === "memory" ? "Local" : "GitHub";
}

/**
 * Material symbol icons are SVGs that paint with an explicit color. The color
 * comes from the resolved style token (a string, not a hook), so this stays a
 * plain component and never reaches for `useUnistyles`.
 */
function KanbanIcon({
  icon: Icon,
  size,
  color,
}: {
  icon: IconComponent;
  size: number;
  color: string;
}): ReactElement {
  return <Icon size={size} color={color} />;
}

// ── Board options (multi-host fan-out) ──────────────────────────────────────

interface BoardSelection {
  serverId: string;
  providerId: KanbanProviderId;
  boardId: string;
}

interface BoardOption extends BoardSelection {
  title: string;
}

/**
 * Boards are fetched per (host, provider). Fans out across every connected
 * host that advertises the kanban feature and merges the results into one
 * flat picker list. Clients are read imperatively from the runtime store -
 * the per-host `useHostRuntimeClient` hook cannot be called from a plain
 * async helper.
 */
function useKanbanBoardOptions(refreshKey: number): {
  options: BoardOption[];
  isLoading: boolean;
} {
  const hosts = useHosts();
  const sessions = useSessionStore((state) => state.sessions);
  const connectedHosts = useMemo(
    () =>
      hosts.filter((host) => {
        const session = sessions[host.serverId];
        return (
          session?.serverInfo?.features?.kanbanBoard === true &&
          getHostRuntimeStore().getClient(host.serverId) !== null
        );
      }),
    [hosts, sessions],
  );

  const [options, setOptions] = useState<BoardOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (connectedHosts.length === 0) {
      setOptions([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    const jobs: Promise<void>[] = [];
    for (const host of connectedHosts) {
      for (const providerId of PROVIDER_OPTIONS) {
        jobs.push(
          (async (): Promise<void> => {
            const boards = await loadBoardsForHost(host.serverId, providerId);
            if (cancelled) return;
            setOptions((prev) => mergeBoardOptions(prev, host.serverId, providerId, boards));
          })(),
        );
      }
    }
    const settle = async (): Promise<void> => {
      await Promise.allSettled(jobs);
      if (!cancelled) setIsLoading(false);
    };
    void settle();
    return () => {
      cancelled = true;
    };
  }, [connectedHosts, refreshKey]);

  return { options, isLoading };
}

function mergeBoardOptions(
  prev: BoardOption[],
  serverId: string,
  providerId: KanbanProviderId,
  boards: KanbanBoardRef[],
): BoardOption[] {
  const kept = prev.filter((o) => !(o.serverId === serverId && o.providerId === providerId));
  const added: BoardOption[] = boards.map((board) => ({
    serverId,
    providerId,
    boardId: board.boardId,
    title: board.title,
  }));
  return [...kept, ...added];
}

async function loadBoardsForHost(
  serverId: string,
  providerId: KanbanProviderId,
): Promise<KanbanBoardRef[]> {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) {
    return [];
  }
  try {
    const payload = await client.kanbanListBoards(providerId);
    // An unconfigured GitHub token is the normal state: the provider reports
    // it as an error and the board list is simply empty.
    return payload.error ? [] : (payload.boards ?? []);
  } catch {
    return [];
  }
}

function renderKanbanScreenBody(input: {
  state: KanbanScreenBodyState;
  options: BoardOption[];
  selected: BoardSelection | null;
  onSelect: (selection: BoardSelection) => void;
}): ReactElement {
  if (input.state.kind === "loading") {
    return (
      <View style={styles.centered}>
        <LoadingSpinner size="large" />
      </View>
    );
  }
  if (input.state.kind === "empty") {
    return (
      <View style={styles.centered} testID="kanban-no-hosts">
        <Text style={styles.message}>No boards available</Text>
        <Text style={styles.messageSub}>
          Connect a host with the Kanban feature to see its boards.
        </Text>
      </View>
    );
  }
  return (
    <KanbanBoardPicker
      options={input.options}
      selected={input.selected}
      onSelect={input.onSelect}
    />
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function KanbanScreen(): ReactElement {
  const [refreshKey, setRefreshKey] = useState(0);
  const { options, isLoading: optionsLoading } = useKanbanBoardOptions(refreshKey);
  const [selected, setSelected] = useState<BoardSelection | null>(null);

  // Default to the first board that appears; keep a manual choice sticky.
  const firstOption = options[0] ?? null;
  useEffect(() => {
    if (!selected && firstOption) {
      setSelected(firstOption);
    }
    if (selected && !options.some((o) => o.boardId === selected.boardId)) {
      setSelected(firstOption);
    }
  }, [options, selected, firstOption]);

  const handleRefresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  const refreshButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={RefreshCw}
        onPress={handleRefresh}
        testID="kanban-refresh"
        accessibilityLabel="Refresh boards"
      />
    ),
    [handleRefresh],
  );

  const body = renderKanbanScreenBody({
    state: resolveKanbanScreenBodyState({ isLoading: optionsLoading, boardCount: options.length }),
    options,
    selected,
    onSelect: setSelected,
  });

  return (
    <View style={styles.container}>
      <MenuHeader title="Boards" rightContent={refreshButton} />
      {body}
      {selected ? (
        <KanbanBoardView
          key={`${selected.serverId}:${selected.providerId}:${selected.boardId}:${refreshKey}`}
          selection={selected}
        />
      ) : null}
    </View>
  );
}

// ── Board picker ────────────────────────────────────────────────────────────

function KanbanBoardPicker({
  options,
  selected,
  onSelect,
}: {
  options: BoardOption[];
  selected: BoardSelection | null;
  onSelect: (selection: BoardSelection) => void;
}): ReactElement {
  const rows = useMemo(() => {
    const byProvider = new Map<KanbanProviderId, BoardOption[]>();
    for (const option of options) {
      const list = byProvider.get(option.providerId) ?? [];
      list.push(option);
      byProvider.set(option.providerId, list);
    }
    return Array.from(byProvider.entries());
  }, [options]);

  return (
    <View style={styles.picker}>
      {rows.map(([providerId, boards]) => (
        <View key={providerId} style={styles.pickerRow} testID={`kanban-picker-${providerId}`}>
          <Text style={styles.pickerLabel}>{providerLabel(providerId)}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pickerScroll}
            contentContainerStyle={styles.pickerScrollContent}
          >
            {boards.map((board) => (
              <KanbanPickerChip
                key={board.boardId}
                option={board}
                providerId={providerId}
                isSelected={
                  selected !== null &&
                  selected.providerId === providerId &&
                  selected.boardId === board.boardId
                }
                onSelect={onSelect}
              />
            ))}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

function KanbanPickerChip({
  option,
  providerId,
  isSelected,
  onSelect,
}: {
  option: BoardOption;
  providerId: KanbanProviderId;
  isSelected: boolean;
  onSelect: (selection: BoardSelection) => void;
}): ReactElement {
  const handlePress = useCallback(() => {
    onSelect({ serverId: option.serverId, providerId, boardId: option.boardId });
  }, [option.serverId, providerId, option.boardId, onSelect]);

  const chipStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.pickerChip,
      isSelected ? styles.pickerChipSelected : null,
      pressed ? styles.pickerChipPressed : null,
    ],
    [isSelected],
  );

  return (
    <Pressable
      testID={`kanban-picker-${option.boardId}`}
      accessibilityRole="button"
      accessibilityLabel={option.title}
      onPress={handlePress}
      style={chipStyle}
    >
      <Text style={styles.pickerChipText} numberOfLines={1}>
        {option.title}
      </Text>
    </Pressable>
  );
}

// ── Board view ──────────────────────────────────────────────────────────────

function KanbanBoardView({ selection }: { selection: BoardSelection }): ReactElement {
  const [refreshKey, setRefreshKey] = useState(0);
  const { board, isLoading, error } = useKanbanBoard(
    selection.serverId,
    selection.providerId,
    selection.boardId,
    refreshKey,
  );
  const client = getHostRuntimeStore().getClient(selection.serverId);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  const moveCard = useCallback(
    async (cardId: string, targetColumnId: string) => {
      if (!client) return;
      const payload = await client.kanbanMoveCard({
        providerId: selection.providerId,
        boardId: selection.boardId,
        cardId,
        targetColumnId,
      });
      if (payload.error) {
        throw new Error(payload.error);
      }
      // The board re-fetches from the provider either way, so a failed move
      // still converges on the truth.
      refresh();
    },
    [client, selection, refresh],
  );

  const createCard = useCallback(
    async (columnId: string, title: string) => {
      if (!client) return;
      const payload = await client.kanbanCreateCard({
        providerId: selection.providerId,
        boardId: selection.boardId,
        columnId,
        title,
      });
      if (payload.error) {
        throw new Error(payload.error);
      }
      refresh();
    },
    [client, selection, refresh],
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <LoadingSpinner size="large" />
      </View>
    );
  }
  if (error || !board) {
    return (
      <View style={styles.centered} testID="kanban-board-error">
        <Text style={styles.message}>{error ?? "Board unavailable"}</Text>
        {selection.providerId === "github" ? (
          <Text style={styles.messageSub}>
            Add a personal access token with the projects permission in the daemon config.
          </Text>
        ) : null}
      </View>
    );
  }

  return <KanbanColumns board={board} onMoveCard={moveCard} onCreateCard={createCard} />;
}

// ── Columns + drag ──────────────────────────────────────────────────────────
//
// Drop targeting is content-relative, not window-relative: columns and cards
// record their layout rects (relative to the board content container / their
// column), and the gesture translation moves a content-space point. This works
// identically on web and native - `measureInWindow` is a native-only API.

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragState {
  card: KanbanCard;
  sourceColumnId: string;
  /** Card origin in board-content coordinates at drag start. */
  origin: Rect;
  /** Current finger offset from the drag origin, in board-content coordinates. */
  x: number;
  y: number;
}

function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function KanbanColumns({
  board,
  onMoveCard,
  onCreateCard,
}: {
  board: { columns: KanbanColumn[] };
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
  onCreateCard: (columnId: string, title: string) => Promise<void>;
}): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const columnRectsRef = useRef<Map<string, Rect>>(new Map());
  const cardRectsRef = useRef<Map<string, Rect>>(new Map());

  const recordColumnRect = useCallback((columnId: string, event: LayoutEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    columnRectsRef.current.set(columnId, { x, y, width, height });
  }, []);

  const recordCardRect = useCallback((cardId: string, event: LayoutEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    cardRectsRef.current.set(cardId, { x, y, width, height });
  }, []);

  const findColumnAt = useCallback(
    (x: number, y: number): KanbanColumn | null => {
      for (const column of board.columns) {
        const rect = columnRectsRef.current.get(column.id);
        if (rect && containsPoint(rect, x, y)) {
          return column;
        }
      }
      return null;
    },
    [board],
  );

  const handleDragStart = useCallback((card: KanbanCard, sourceColumnId: string) => {
    const columnRect = columnRectsRef.current.get(sourceColumnId);
    const cardRect = cardRectsRef.current.get(card.id);
    if (!columnRect || !cardRect) return;
    setDrag({
      card,
      sourceColumnId,
      origin: {
        x: columnRect.x + cardRect.x,
        y: columnRect.y + cardRect.y,
        width: cardRect.width,
        height: cardRect.height,
      },
      x: 0,
      y: 0,
    });
    setDraggingCardId(card.id);
  }, []);

  const handleDragChange = useCallback((event: { x: number; y: number }) => {
    setDrag((prev) => (prev ? { ...prev, x: event.x, y: event.y } : prev));
  }, []);

  const handleDragEnd = useCallback(
    (event: { x: number; y: number }) => {
      const prev = drag;
      setDrag(null);
      setDraggingCardId(null);
      if (!prev) return;
      const dropX = prev.origin.x + prev.origin.width / 2 + event.x;
      const dropY = prev.origin.y + prev.origin.height / 2 + event.y;
      const target = findColumnAt(dropX, dropY);
      if (target && target.id !== prev.sourceColumnId) {
        void onMoveCard(prev.card.id, target.id);
      }
    },
    [drag, findColumnAt, onMoveCard],
  );

  const ghostStyle = useMemo(
    () =>
      drag
        ? [
            styles.dragGhost,
            {
              left: drag.origin.x + drag.x,
              top: drag.origin.y + drag.y,
              width: drag.origin.width,
            },
          ]
        : null,
    [drag],
  );

  return (
    <View style={styles.board} testID="kanban-board">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.boardContent}
      >
        {board.columns.map((column) => (
          <KanbanColumnView
            key={column.id}
            column={column}
            columns={board.columns}
            onLayoutColumn={recordColumnRect}
            onLayoutCard={recordCardRect}
            onDragStart={handleDragStart}
            isDropTarget={
              draggingCardId !== null && drag !== null && column.id !== drag.sourceColumnId
            }
            draggingCardId={draggingCardId}
            onCardDragChange={handleDragChange}
            onCardDragEnd={handleDragEnd}
            onMoveCard={onMoveCard}
            onCreateCard={onCreateCard}
            isCompact={isCompact}
          />
        ))}
        {drag && ghostStyle ? (
          <View pointerEvents="none" style={ghostStyle}>
            <Text style={styles.dragGhostText} numberOfLines={2}>
              {drag.card.title}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function KanbanColumnView({
  column,
  columns,
  onLayoutColumn,
  onLayoutCard,
  onDragStart,
  isDropTarget,
  draggingCardId,
  onCardDragChange,
  onCardDragEnd,
  onMoveCard,
  onCreateCard,
  isCompact,
}: {
  column: KanbanColumn;
  columns: KanbanColumn[];
  onLayoutColumn: (columnId: string, event: LayoutEvent) => void;
  onLayoutCard: (cardId: string, event: LayoutEvent) => void;
  onDragStart: (card: KanbanCard, sourceColumnId: string) => void;
  isDropTarget: boolean;
  draggingCardId: string | null;
  onCardDragChange: (event: { x: number; y: number }) => void;
  onCardDragEnd: (event: { x: number; y: number }) => void;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
  onCreateCard: (columnId: string, title: string) => Promise<void>;
  isCompact: boolean;
}): ReactElement {
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleColumnLayout = useCallback(
    (event: LayoutEvent) => onLayoutColumn(column.id, event),
    [onLayoutColumn, column.id],
  );

  const handleCardDragStart = useCallback(
    (card: KanbanCard) => onDragStart(card, column.id),
    [onDragStart, column.id],
  );

  const submitNewCard = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || submitting) return;
    setSubmitting(true);
    try {
      await onCreateCard(column.id, title);
      setNewTitle("");
      setCreating(false);
    } finally {
      setSubmitting(false);
    }
  }, [newTitle, submitting, onCreateCard, column.id]);

  const cancelNewCard = useCallback(() => {
    setCreating(false);
    setNewTitle("");
  }, []);

  const startCreating = useCallback(() => setCreating(true), []);

  const submitOnBlur = useCallback(() => {
    void submitNewCard();
  }, [submitNewCard]);

  const columnStyle = useMemo(
    () => [
      styles.column,
      isCompact ? styles.columnCompact : null,
      isDropTarget ? styles.columnDropTarget : null,
    ],
    [isCompact, isDropTarget],
  );

  return (
    <View
      onLayout={handleColumnLayout}
      style={columnStyle}
      testID={`kanban-column-${column.id}`}
      accessibilityLabel={`${column.name}, ${column.cards.length} cards`}
    >
      <View style={styles.columnHeader}>
        <Text style={styles.columnTitle} numberOfLines={1}>
          {column.name}
        </Text>
        <Text style={styles.columnCount}>{column.cards.length}</Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.columnScroll}
        contentContainerStyle={styles.columnScrollContent}
      >
        {column.cards.map((card) => (
          <KanbanCardView
            key={card.id}
            card={card}
            sourceColumnId={column.id}
            columns={columns}
            onLayout={onLayoutCard}
            isDragging={draggingCardId === card.id}
            onDragStart={handleCardDragStart}
            onDragChange={onCardDragChange}
            onDragEnd={onCardDragEnd}
            onMoveCard={onMoveCard}
          />
        ))}
        {creating ? (
          <View style={styles.createRow}>
            <TextInput
              style={styles.createInput}
              placeholder="Card title"
              placeholderTextColor={styles.createInputPlaceholder.color}
              value={newTitle}
              onChangeText={setNewTitle}
              onEndEditing={submitOnBlur}
              testID="kanban-new-card-input"
              returnKeyType="done"
            />
            <Button
              size="xs"
              variant="ghost"
              leftIcon={Check}
              onPress={submitOnBlur}
              disabled={newTitle.trim().length === 0 || submitting}
              testID="kanban-new-card-confirm"
            />
            <Button
              size="xs"
              variant="ghost"
              onPress={cancelNewCard}
              testID="kanban-new-card-cancel"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Button>
          </View>
        ) : (
          <Pressable
            onPress={startCreating}
            style={styles.addCardButton}
            testID={`kanban-add-card-${column.id}`}
            accessibilityRole="button"
          >
            <KanbanIcon icon={Plus} size={16} color={styles.addCardText.color} />
            <Text style={styles.addCardText}>Add card</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function KanbanCardView({
  card,
  sourceColumnId,
  columns,
  onLayout,
  isDragging,
  onDragStart,
  onDragChange,
  onDragEnd,
  onMoveCard,
}: {
  card: KanbanCard;
  sourceColumnId: string;
  columns: KanbanColumn[];
  onLayout: (cardId: string, event: LayoutEvent) => void;
  isDragging: boolean;
  onDragStart: (card: KanbanCard) => void;
  onDragChange: (event: { x: number; y: number }) => void;
  onDragEnd: (event: { x: number; y: number }) => void;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
}): ReactElement {
  const handleLayout = useCallback(
    (event: LayoutEvent) => onLayout(card.id, event),
    [onLayout, card.id],
  );

  const startDrag = useCallback(() => onDragStart(card), [onDragStart, card]);

  const handleGestureStart = useCallback(() => startDrag(), [startDrag]);
  const handleGestureUpdate = useCallback(
    (event: { translationX: number; translationY: number }) =>
      onDragChange({ x: event.translationX, y: event.translationY }),
    [onDragChange],
  );
  const handleGestureEnd = useCallback(
    (event: { translationX: number; translationY: number }) =>
      onDragEnd({ x: event.translationX, y: event.translationY }),
    [onDragEnd],
  );

  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(8)
        .onStart(handleGestureStart)
        .onUpdate(handleGestureUpdate)
        .onEnd(handleGestureEnd),
    [handleGestureStart, handleGestureUpdate, handleGestureEnd],
  );

  const cardStyle = useMemo(
    () => [styles.card, isDragging ? styles.cardDragging : null],
    [isDragging],
  );

  const openLink = useCallback(() => {
    if (card.url) {
      void Linking.openURL(card.url).catch(() => undefined);
    }
  }, [card.url]);

  return (
    <GestureDetector gesture={dragGesture}>
      <View onLayout={handleLayout} style={cardStyle} accessibilityLabel={card.title}>
        <Text style={styles.cardTitle} numberOfLines={3}>
          {card.title}
        </Text>
        {card.body ? (
          <Text style={styles.cardDescription} numberOfLines={2}>
            {card.body}
          </Text>
        ) : null}
        <View style={styles.cardFooter}>
          <KanbanIcon icon={ListChevronsUpDown} size={13} color={styles.cardAssignees.color} />
          {card.assignees.length > 0 ? (
            <Text style={styles.cardAssignees} numberOfLines={1}>
              {card.assignees.join(", ")}
            </Text>
          ) : null}
          {card.url ? (
            <Pressable
              onPress={openLink}
              style={styles.cardLink}
              testID={`kanban-card-link-${card.id}`}
              accessibilityRole="link"
            >
              <KanbanIcon icon={ExternalLink} size={14} color={styles.cardAssignees.color} />
            </Pressable>
          ) : null}
          <KanbanCardMoveMenu
            card={card}
            sourceColumnId={sourceColumnId}
            columns={columns}
            onMoveCard={onMoveCard}
          />
        </View>
      </View>
    </GestureDetector>
  );
}

function KanbanCardMoveMenu({
  card,
  sourceColumnId,
  columns,
  onMoveCard,
}: {
  card: KanbanCard;
  sourceColumnId: string;
  columns: KanbanColumn[];
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
}): ReactElement | null {
  const targets = useMemo(
    () => columns.filter((column) => column.id !== sourceColumnId),
    [columns, sourceColumnId],
  );
  if (targets.length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={styles.cardMenuButton}
        testID={`kanban-card-menu-${card.id}`}
        accessibilityLabel={`Move ${card.title}`}
      >
        <KanbanIcon icon={MoreVertical} size={16} color={styles.cardAssignees.color} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {targets.map((column) => (
          <KanbanMoveMenuItem
            key={column.id}
            cardId={card.id}
            column={column}
            onMoveCard={onMoveCard}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KanbanMoveMenuItem({
  cardId,
  column,
  onMoveCard,
}: {
  cardId: string;
  column: KanbanColumn;
  onMoveCard: (cardId: string, targetColumnId: string) => Promise<void>;
}): ReactElement {
  const handleSelect = useCallback(() => {
    void onMoveCard(cardId, column.id);
  }, [onMoveCard, cardId, column.id]);
  return (
    <DropdownMenuItem testID={`kanban-move-to-${column.id}`} onSelect={handleSelect}>
      Move to {column.name}
    </DropdownMenuItem>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.lg,
    textAlign: "center",
  },
  messageSub: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    maxWidth: 360,
  },
  picker: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  pickerLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    width: 64,
  },
  pickerScroll: {
    flexShrink: 1,
  },
  pickerScrollContent: {
    gap: theme.spacing[2],
  },
  pickerChip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pickerChipSelected: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  pickerChipPressed: {
    backgroundColor: theme.colors.surface3,
  },
  pickerChipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    maxWidth: 200,
  },
  board: {
    flex: 1,
    minHeight: 0,
  },
  boardContent: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[4],
  },
  column: {
    width: 300,
    maxWidth: "80%",
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 120,
  },
  columnCompact: {
    width: 260,
  },
  columnDropTarget: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  columnTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  columnCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
  },
  columnScroll: {
    flex: 1,
    minHeight: 0,
  },
  columnScrollContent: {
    gap: theme.spacing[2],
    padding: theme.spacing[2],
  },
  card: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[2],
    gap: theme.spacing[1],
  },
  cardDragging: {
    opacity: 0.4,
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  cardDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  cardAssignees: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  cardLink: {
    padding: 2,
  },
  cardMenuButton: {
    padding: 2,
    borderRadius: theme.borderRadius.base,
  },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  createInput: {
    flex: 1,
    minHeight: 32,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  createInputPlaceholder: {
    color: theme.colors.foregroundMuted,
  },
  cancelText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  addCardButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
  },
  addCardText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  dragGhost: {
    position: "absolute",
    zIndex: 1000,
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    padding: theme.spacing[2],
  },
  dragGhostText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));

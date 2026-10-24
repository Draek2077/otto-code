import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { FlatList, ScrollView } from "@getpaseo/plugin/client/react-native";
import {
  ExternalLink,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
  SettingsButton,
} from "@getpaseo/plugin/client/ui";
import type { Board } from "../shared/model.js";

type Card = Board["cards"][number];
const columnStyle = { width: 300, minHeight: 180, gap: 8 } as const;
const compactColumnStyle = { flex: 1, gap: 8 } as const;
const boardContentStyle = { gap: 16, paddingVertical: 12 } as const;
const listContentStyle = { gap: 8, paddingBottom: 16 } as const;
const panelStyle = { flex: 1, gap: 12 } as const;
const emptyCards: Card[] = [];

function EmptyColumn() {
  return <SettingsRow label="No cards in this column." />;
}

function CardRow({
  card,
  onOpenError,
  onSelectCard,
}: {
  card: Card;
  onOpenError(): void;
  onSelectCard(id: string): void;
}) {
  const select = useCallback(() => onSelectCard(card.id), [onSelectCard, card.id]);
  return (
    <SettingsCard testID={`kanban-card-${card.id}`}>
      <SettingsRow
        label={card.title}
        hint={card.description ? card.description.slice(0, 180) : undefined}
      />
      {card.archived ? <SettingsRow label="Archived" /> : null}
      <SettingsButton onPress={select} variant="outline">
        View card
      </SettingsButton>
      {card.assignees.length ? (
        <SettingsRow label={`Assigned to ${card.assignees.join(", ")}`} />
      ) : null}
      {card.url ? (
        <ExternalLink
          href={card.url}
          onError={onOpenError}
          accessibilityLabel={`Open ${card.title} in its provider`}
        >
          Open in provider
        </ExternalLink>
      ) : null}
    </SettingsCard>
  );
}

function BoardColumn({
  column,
  cards,
  compact,
  color,
  onOpenError,
  onSelectCard,
}: {
  column: Board["columns"][number];
  cards: Card[];
  compact: boolean;
  color: string;
  onOpenError(): void;
  onSelectCard(id: string): void;
}) {
  const renderCard = useCallback(
    ({ item }: { item: Card }) => (
      <CardRow card={item} onOpenError={onOpenError} onSelectCard={onSelectCard} />
    ),
    [onOpenError, onSelectCard],
  );
  const headerStyle = useMemo(() => ({ color }), [color]);
  return (
    <View style={compact ? compactColumnStyle : columnStyle}>
      <Text accessibilityRole="header" style={headerStyle}>
        {column.title} ({cards.length})
      </Text>
      <FlatList
        data={cards}
        keyExtractor={cardKey}
        renderItem={renderCard}
        contentContainerStyle={listContentStyle}
        ListEmptyComponent={EmptyColumn}
      />
    </View>
  );
}

function cardKey(card: Card) {
  return card.id;
}

export function BoardView({
  board,
  layout,
  theme,
  onSelectCard,
  columnId,
  onColumnChange,
}: {
  board: Board;
  layout: PluginScreenProps["layout"];
  theme: PluginScreenProps["theme"];
  onSelectCard(id: string): void;
  columnId: string;
  onColumnChange(id: string): void;
}) {
  const [openError, setOpenError] = useState(false);
  const onOpenError = useCallback(() => setOpenError(true), []);
  const columnOptions = useMemo(
    () => board.columns.map((column) => ({ label: column.title, value: column.id })),
    [board.columns],
  );
  const byColumn = useMemo(() => {
    const result = new Map<string, Card[]>();
    for (const column of board.columns) result.set(column.id, []);
    for (const card of board.cards) result.get(card.columnId)?.push(card);
    return result;
  }, [board]);
  const selected = board.columns.find((column) => column.id === columnId) ?? board.columns[0];
  return (
    <View style={panelStyle}>
      <SettingsRow label={board.title} />
      {board.url ? (
        <ExternalLink href={board.url} onError={onOpenError}>
          Open board in provider
        </ExternalLink>
      ) : null}
      {openError ? (
        <SettingsRow
          label="The provider link could not be opened."
          error="Try opening the link again."
        />
      ) : null}
      {!board.cards.length ? <SettingsRow label="This board has no cards." /> : null}
      {layout.compact ? (
        <>
          <SettingsSelect
            label="Column"
            value={selected?.id ?? ""}
            onValueChange={onColumnChange}
            options={columnOptions}
          />
          {selected ? (
            <BoardColumn
              column={selected}
              cards={byColumn.get(selected.id) ?? emptyCards}
              compact
              color={theme.colors.foreground}
              onOpenError={onOpenError}
              onSelectCard={onSelectCard}
            />
          ) : null}
        </>
      ) : (
        <ScrollView horizontal contentContainerStyle={boardContentStyle}>
          {board.columns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              cards={byColumn.get(column.id) ?? emptyCards}
              compact={false}
              color={theme.colors.foreground}
              onOpenError={onOpenError}
              onSelectCard={onSelectCard}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

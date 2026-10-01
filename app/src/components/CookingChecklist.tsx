import React, { useState } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import {
  addLine,
  cleanLineText,
  CookingLine,
  editLine,
  isCountable,
  isHeading,
  isShown,
  LineKind,
  lineStatus,
  LineStatus,
  removeLine,
  undoLine,
} from '../cooking/cookingLines';
import { headingText } from '../recipes/recipeForm';
import { strings } from '../strings';
import { colors, fonts } from '../theme';

// Which line the editor is open for; 'new' = a line being added.
type Editing = number | 'new' | null;

type Props = {
  kind: LineKind;
  title: string;
  progress: string;
  addLabel: string;
  lines: CookingLine[];
  checked: number[];
  highlighted?: number;
  style?: StyleProp<ViewStyle>;
  onToggle: (index: number) => void;
  onChangeLines: (lines: CookingLine[]) => void;
  onLayout?: (y: number) => void;
  onRowLayout?: (index: number, y: number) => void;
  // Steps only: start a note for this step (gets the shown step number).
  onNote?: (number: number) => void;
  // Shown under a line still in use, e.g. a step's timer chip.
  renderExtra?: (index: number, number: number) => React.ReactNode;
};

// One checklist section (ingredients or steps) in cooking mode. Rows can be
// edited, removed and added for this attempt only; the recipe never changes.
export default function CookingChecklist({
  kind,
  title,
  progress,
  addLabel,
  lines,
  checked,
  highlighted,
  style,
  onToggle,
  onChangeLines,
  onLayout,
  onRowLayout,
  onNote,
  renderExtra,
}: Props) {
  const [editing, setEditing] = useState<Editing>(null);
  let number = 0;

  return (
    <View
      style={style}
      onLayout={event => onLayout?.(event.nativeEvent.layout.y)}
    >
      <View style={styles.heading}>
        <Text style={styles.headingTitle}>{title}</Text>
        <Text
          testID={`cooking-${kind}-progress-text`}
          style={styles.headingProgress}
        >
          {progress}
        </Text>
      </View>

      {lines.map((line, index) => {
        if (!isShown(line)) return null;
        if (isCountable(line)) number += 1;
        const layout = (y: number) => onRowLayout?.(index, y);

        if (editing === index) {
          return (
            <LineEditor
              key={index}
              kind={kind}
              initialText={line.text ?? ''}
              canRemove
              onCancel={() => setEditing(null)}
              onRemove={() => {
                onChangeLines(removeLine(lines, index));
                setEditing(null);
              }}
              onSave={text => {
                onChangeLines(editLine(lines, index, text));
                setEditing(null);
              }}
              onLayout={layout}
            />
          );
        }

        if (isHeading(line)) {
          return (
            <HeadingRow
              key={index}
              kind={kind}
              index={index}
              line={line}
              onUndo={() => onChangeLines(undoLine(lines, index))}
              onLayout={layout}
            />
          );
        }

        return (
          <LineRow
            key={index}
            kind={kind}
            index={index}
            line={line}
            number={kind === LineKind.Step ? number : undefined}
            checked={checked.includes(index)}
            highlighted={index === highlighted}
            onToggle={() => onToggle(index)}
            onEdit={() => setEditing(index)}
            onUndo={() => onChangeLines(undoLine(lines, index))}
            onNote={onNote}
            extra={isCountable(line) ? renderExtra?.(index, number) : undefined}
            onLayout={layout}
          />
        );
      })}

      {editing === 'new' ? (
        <LineEditor
          kind={kind}
          initialText=""
          onCancel={() => setEditing(null)}
          onSave={text => {
            onChangeLines(addLine(lines, text));
            setEditing(null);
          }}
        />
      ) : (
        <Pressable
          testID={`cooking-add-${kind}-button`}
          accessibilityRole="button"
          style={styles.addButton}
          onPress={() => setEditing('new')}
        >
          <Text style={styles.addText}>{addLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

// A section heading ("FOR THE CREAM"): a divider, not a checklist row. No
// ✎, no note, no timer. One added or changed this time can still be undone.
function HeadingRow({
  kind,
  index,
  line,
  onUndo,
  onLayout,
}: {
  kind: LineKind;
  index: number;
  line: CookingLine;
  onUndo: () => void;
  onLayout: (y: number) => void;
}) {
  const status = lineStatus(line);
  return (
    <View
      style={styles.headingRow}
      onLayout={event => onLayout(event.nativeEvent.layout.y)}
    >
      <Text
        testID={`cooking-${kind}-heading-${index}`}
        accessibilityRole="header"
        style={styles.headingRowText}
      >
        {headingText(line.text ?? '')}
      </Text>
      {status !== LineStatus.Unchanged ? (
        <View style={styles.changeLine}>
          <Text style={styles.changeText}>
            {status === LineStatus.Added
              ? strings.cooking.added
              : strings.cooking.was}
            {status === LineStatus.Edited ? (
              <Text style={styles.struck}> {line.original}</Text>
            ) : null}{' '}
            ·{' '}
          </Text>
          <Pressable
            testID={`cooking-${kind}-undo-${index}`}
            accessibilityRole="button"
            accessibilityLabel={strings.cooking.undoChange(line.original ?? '')}
            hitSlop={12}
            onPress={onUndo}
          >
            <Text style={styles.undoText}>{strings.cooking.undo}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

type LineRowProps = {
  kind: LineKind;
  index: number;
  line: CookingLine;
  number?: number;
  checked: boolean;
  highlighted: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onUndo: () => void;
  onNote?: (number: number) => void;
  extra?: React.ReactNode;
  onLayout: (y: number) => void;
};

function LineRow({
  kind,
  index,
  line,
  number,
  checked,
  highlighted,
  onToggle,
  onEdit,
  onUndo,
  onNote,
  extra,
  onLayout,
}: LineRowProps) {
  const status = lineStatus(line);
  const undoButton = (
    <Pressable
      testID={`cooking-${kind}-undo-${index}`}
      accessibilityRole="button"
      accessibilityLabel={strings.cooking.undoChange(line.original ?? '')}
      hitSlop={12}
      onPress={onUndo}
    >
      <Text style={styles.undoText}>{strings.cooking.undo}</Text>
    </Pressable>
  );

  const indent = number !== undefined ? styles.stepIndent : styles.indent;

  if (status === LineStatus.Removed) {
    return (
      <View
        testID={`cooking-${kind}-${index}`}
        style={styles.row}
        onLayout={event => onLayout(event.nativeEvent.layout.y)}
      >
        <View style={[styles.removedBody, indent]}>
          <Text style={[styles.rowText, styles.struck]}>{line.original}</Text>
          <View style={styles.changeLine}>
            <Text style={styles.changeText}>{strings.cooking.removed} · </Text>
            {undoButton}
          </View>
        </View>
      </View>
    );
  }

  const text = line.text ?? '';
  // The check area, ✎ and undo are siblings, not nested: screen readers
  // can't reach a button inside another accessible element.
  return (
    <View
      style={[styles.row, highlighted && styles.rowHighlighted]}
      onLayout={event => onLayout(event.nativeEvent.layout.y)}
    >
      <View style={styles.rowTop}>
        {/* Most of the row is the tap target, so it works with messy hands. */}
        <Pressable
          testID={`cooking-${kind}-${index}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={
            number !== undefined
              ? strings.cooking.stepLabel(number, text)
              : text
          }
          style={styles.checkArea}
          onPress={onToggle}
        >
          <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
            {checked ? <Text style={styles.checkmark}>✓</Text> : null}
          </View>
          {number !== undefined ? (
            <Text style={styles.stepNumber}>{number}</Text>
          ) : null}
          <Text style={[styles.rowText, checked && styles.struck]}>{text}</Text>
        </Pressable>
        <View>
          <Pressable
            testID={`cooking-${kind}-edit-${index}`}
            accessibilityRole="button"
            accessibilityLabel={strings.cooking.editLine(text)}
            style={styles.editButton}
            onPress={onEdit}
          >
            <Text style={styles.editIcon}>✎</Text>
          </Pressable>
          {onNote && number !== undefined ? (
            <Pressable
              testID={`cooking-${kind}-note-${index}`}
              accessibilityRole="button"
              accessibilityLabel={strings.cooking.addStepNote(number)}
              style={styles.noteButton}
              onPress={() => onNote(number)}
            >
              <Text style={styles.editIcon}>✍</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {status === LineStatus.Edited ? (
        <View style={[styles.changeLine, styles.changeBelow, indent]}>
          <Text style={styles.changeText}>
            {strings.cooking.was}{' '}
            <Text style={styles.struck}>{line.original}</Text> ·{' '}
          </Text>
          {undoButton}
        </View>
      ) : null}
      {status === LineStatus.Added ? (
        <View style={[styles.changeLine, styles.changeBelow, indent]}>
          <Text style={styles.changeText}>{strings.cooking.added}</Text>
        </View>
      ) : null}
      {extra ? <View style={[styles.extra, indent]}>{extra}</View> : null}
    </View>
  );
}

type LineEditorProps = {
  kind: LineKind;
  initialText: string;
  canRemove?: boolean;
  onCancel: () => void;
  onRemove?: () => void;
  onSave: (text: string) => void;
  onLayout?: (y: number) => void;
};

function LineEditor({
  kind,
  initialText,
  canRemove = false,
  onCancel,
  onRemove,
  onSave,
  onLayout,
}: LineEditorProps) {
  const [text, setText] = useState(initialText);
  const cleaned = cleanLineText(text);

  return (
    <View
      style={styles.editor}
      onLayout={event => onLayout?.(event.nativeEvent.layout.y)}
    >
      <TextInput
        testID={`cooking-${kind}-input`}
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={
          kind === LineKind.Step
            ? strings.cooking.newStepPlaceholder
            : strings.cooking.newIngredientPlaceholder
        }
        placeholderTextColor={colors.placeholderText}
        multiline
        autoFocus
      />
      <View style={styles.editorActions}>
        <Pressable
          testID={`cooking-${kind}-cancel-button`}
          accessibilityRole="button"
          style={styles.editorButton}
          onPress={onCancel}
        >
          <Text style={styles.editorButtonText}>{strings.common.cancel}</Text>
        </Pressable>
        {canRemove ? (
          <Pressable
            testID={`cooking-${kind}-remove-button`}
            accessibilityRole="button"
            style={styles.editorButton}
            onPress={onRemove}
          >
            <Text style={[styles.editorButtonText, styles.removeText]}>
              {strings.cooking.remove}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          testID={`cooking-${kind}-save-button`}
          accessibilityRole="button"
          accessibilityState={{ disabled: cleaned.length === 0 }}
          disabled={cleaned.length === 0}
          style={[
            styles.editorButton,
            styles.saveButton,
            cleaned.length === 0 && styles.saveButtonDisabled,
          ]}
          onPress={() => onSave(cleaned)}
        >
          <Text style={[styles.editorButtonText, styles.saveText]}>
            {strings.cooking.save}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  headingTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: colors.ink,
  },
  headingProgress: {
    fontSize: 15,
    color: colors.ink,
  },
  headingRow: {
    paddingTop: 20,
    paddingBottom: 8,
    paddingLeft: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  headingRowText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  row: {
    paddingLeft: 12,
    borderLeftWidth: 4,
    borderColor: 'transparent',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowHighlighted: {
    borderLeftColor: colors.accent,
    backgroundColor: colors.card,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  checkArea: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
  },
  // Lines up text under the row text: checkbox (26 + 14), plus the step number.
  indent: {
    marginLeft: 40,
  },
  stepIndent: {
    marginLeft: 72,
  },
  removedBody: {
    paddingVertical: 14,
  },
  checkbox: {
    width: 26,
    height: 26,
    marginTop: 1,
    marginRight: 14,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.ink,
  },
  checkmark: {
    color: colors.card,
    fontSize: 16,
    fontWeight: '700',
  },
  stepNumber: {
    minWidth: 24,
    marginRight: 8,
    fontFamily: fonts.serif,
    fontSize: 20,
    lineHeight: 28,
    color: colors.ink,
  },
  rowText: {
    flex: 1,
    fontSize: 20,
    lineHeight: 28,
    color: colors.ink,
  },
  // Stays in ink, not inkMuted: checked and changed lines must remain readable.
  struck: {
    textDecorationLine: 'line-through',
  },
  changeLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    marginTop: 4,
  },
  extra: {
    marginTop: -4,
    paddingBottom: 12,
  },
  changeBelow: {
    marginTop: -6,
    paddingBottom: 12,
  },
  changeText: {
    fontSize: 15,
    color: colors.ink,
  },
  undoText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  editButton: {
    width: 48,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 14,
  },
  noteButton: {
    width: 48,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editIcon: {
    fontSize: 22,
    color: colors.ink,
  },
  addButton: {
    minHeight: 56,
    justifyContent: 'center',
    paddingLeft: 16,
  },
  addText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.ink,
  },
  editor: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  input: {
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    fontSize: 20,
    lineHeight: 28,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  editorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    marginTop: 10,
    gap: 8,
  },
  editorButton: {
    minHeight: 48,
    minWidth: 88,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.ink,
  },
  removeText: {
    color: colors.danger,
  },
  saveButton: {
    backgroundColor: colors.accent,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveText: {
    color: colors.card,
  },
});

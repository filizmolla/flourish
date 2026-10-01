import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useKeepAwake } from '@sayem314/react-native-keep-awake';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from 'react-native';
import { AttemptDetail, Recipe } from '../api/recipesClient';
import CookingChecklist from '../components/CookingChecklist';
import CookingClockText from '../components/CookingClockText';
import FinishSheet, { FinishValues } from '../components/FinishSheet';
import MinutesStepper from '../components/MinutesStepper';
import ResumeDraftPrompt from '../components/ResumeDraftPrompt';
import TimerDoneSheet from '../components/TimerDoneSheet';
import TimerStack from '../components/TimerStack';
import {
  changedTexts,
  CookingLine,
  countChanged,
  countCountable,
  isCountable,
  LineKind,
  linesFromBase,
  linesFromVersion,
} from '../cooking/cookingLines';
import {
  CookingClock,
  elapsedMs,
  isClockRunning,
  pauseClock,
  resumeClock,
  startClock,
} from '../cooking/cookingClock';
import {
  clockFromDraft,
  CookingDraft,
  clearDraft,
  loadDraft,
  saveDraft,
} from '../cooking/cookingDraft';
import { addStepNotePrefix } from '../cooking/cookingNotes';
import {
  CookingTimer,
  detectDurationMinutes,
  formatRemaining,
  isFinished,
  isPaused,
  nextManualTimer,
  pauseTimer,
  remainingMs,
  removeTimer,
  restartTimer,
  resumeTimer,
  sortBySoonest,
  startTimer,
  stepTimerId,
} from '../cooking/cookingTimers';
import { useAttempt, useCreateAttempt } from '../hooks/useAttempts';
import { useRecipe } from '../hooks/useRecipes';
import { AppStackParamList, Screens } from '../navigation/types';
import { splitLines } from '../recipes/recipeForm';
import { strings } from '../strings';
import {
  formatPostedDate,
  formatShortDate,
  formatTimeAgo,
} from '../utils/recipeFormat';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, Screens.Cooking>;

function ExitButton() {
  const navigation = useNavigation();
  return (
    <Pressable
      testID="cooking-exit-button"
      accessibilityRole="button"
      accessibilityLabel={strings.cooking.exit}
      hitSlop={12}
      onPress={() => navigation.goBack()}
    >
      <Text style={styles.exitText}>✕</Text>
    </Pressable>
  );
}

const renderExitButton = () => <ExitButton />;

function FinishButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      testID="cooking-finish-button"
      accessibilityRole="button"
      hitSlop={12}
      onPress={onPress}
    >
      <Text style={styles.finishText}>{strings.cooking.finish}</Text>
    </Pressable>
  );
}

// Built outside the component so the header gets a plain render function,
// not a component type recreated on every render.
function renderFinishButton(onPress: () => void) {
  return () => <FinishButton onPress={onPress} />;
}

// "You changed 1 ingredient and 2 steps.", or null when nothing changed.
function changeSummary(ingredients: number, steps: number): string | null {
  const { finish } = strings;
  if (ingredients > 0 && steps > 0) {
    return finish.youChangedBoth(
      finish.changedIngredients(ingredients),
      finish.changedSteps(steps),
    );
  }
  if (ingredients > 0) {
    return finish.youChanged(finish.changedIngredients(ingredients));
  }
  if (steps > 0) return finish.youChanged(finish.changedSteps(steps));
  return null;
}

const DEFAULT_TIMER_MINUTES = 5;
// Wait for a pause in typing or tapping before writing the draft.
const SAVE_DELAY_MS = 500;

// The past attempt this session is a new version of.
type BasedOn = { id: string; madeAt?: string };

// "Cook this version again": where a session starts when there's no draft.
type StartVersion = {
  basedOn: BasedOn;
  ingredientLines: CookingLine[] | null;
  stepLines: CookingLine[] | null;
};

function versionStart(recipe: Recipe, attempt: AttemptDetail): StartVersion {
  return {
    basedOn: { id: attempt.id, madeAt: attempt.madeAt },
    ingredientLines: linesFromVersion(
      recipe.ingredients,
      attempt.ingredients?.map(line => line.text) ?? null,
    ),
    stepLines: linesFromVersion(
      splitLines(recipe.instructions),
      attempt.instructions === null ? null : splitLines(attempt.instructions),
    ),
  };
}

type DraftFields = {
  recipeId: string;
  basedOn: BasedOn | null;
  startedAt: number;
  clock: CookingClock;
  ingredientLines: CookingLine[] | null;
  stepLines: CookingLine[] | null;
  checkedIngredients: number[];
  checkedSteps: number[];
  notes: string;
  timers: CookingTimer[];
};

// Time is banked up to the save, so a draft left by a closed app never
// counts the time away (see clockFromDraft).
function toDraft(fields: DraftFields, at: number): CookingDraft {
  return {
    version: 1,
    recipeId: fields.recipeId,
    basedOnAttemptId: fields.basedOn?.id,
    basedOnMadeAt: fields.basedOn?.madeAt,
    startedAt: fields.startedAt,
    savedAt: at,
    elapsedMs: elapsedMs(fields.clock, at),
    activeSince: isClockRunning(fields.clock) ? at : undefined,
    ingredients: fields.ingredientLines,
    instructions: fields.stepLines,
    checkedIngredients: fields.checkedIngredients,
    checkedSteps: fields.checkedSteps,
    notes: fields.notes,
    timers: fields.timers,
  };
}

// Just opening cooking mode and leaving again doesn't leave a draft behind.
// `start` holds the lines the session opened with (a past version's edits
// count as the starting point, not as progress).
function hasProgress(
  fields: DraftFields,
  start: {
    ingredientLines: CookingLine[] | null;
    stepLines: CookingLine[] | null;
  },
): boolean {
  return (
    fields.checkedIngredients.length > 0 ||
    fields.checkedSteps.length > 0 ||
    fields.ingredientLines !== start.ingredientLines ||
    fields.stepLines !== start.stepLines ||
    fields.notes.trim().length > 0 ||
    fields.timers.length > 0
  );
}

function toggle(indexes: number[], index: number): number[] {
  return indexes.includes(index)
    ? indexes.filter(i => i !== index)
    : [...indexes, index];
}

// First step still in use and not checked yet; -1 when all are done.
function findNextStep(lines: CookingLine[], checked: number[]): number {
  return lines.findIndex(
    (line, index) => isCountable(line) && !checked.includes(index),
  );
}

// Shown step number (1, 2, …) per line index, skipping removed lines and
// headings; numbers run on across sections.
function numberActiveLines(lines: CookingLine[]): Record<number, number> {
  const numbers: Record<number, number> = {};
  let number = 0;
  lines.forEach((line, index) => {
    if (isCountable(line)) numbers[index] = ++number;
  });
  return numbers;
}

function countChecked(lines: CookingLine[], checked: number[]): number {
  return checked.filter(index => lines[index] && isCountable(lines[index]))
    .length;
}

// With a saved draft: ask first, then resume it or start over.
enum ResumeChoice {
  Ask = 'ask',
  Resume = 'resume',
  StartOver = 'startOver',
}

export default function CookingScreen({ navigation, route }: Props) {
  const { recipeId, fromAttemptId } = route.params;
  // Already cached from recipe detail, so this normally renders at once.
  const { data: recipe, isPending, isError, error } = useRecipe(recipeId);
  // "Cook this version again": that attempt, cached from attempt detail.
  const versionQuery = useAttempt(fromAttemptId);
  // undefined while reading the phone; null when there's no draft.
  const [draft, setDraft] = useState<CookingDraft | null | undefined>();
  // With a draft, ask first: pick up where you left off, or start over.
  const [resumeChoice, setResumeChoice] = useState(ResumeChoice.Ask);

  useKeepAwake();

  useEffect(() => {
    let current = true;
    loadDraft(recipeId).then(
      loaded => current && setDraft(loaded),
      () => current && setDraft(null),
    );
    return () => {
      current = false;
    };
  }, [recipeId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: recipe?.title ?? '',
      headerLeft: renderExitButton,
    });
  }, [navigation, recipe]);

  const loadError = error ?? versionQuery.error;
  const versionPending = fromAttemptId !== undefined && versionQuery.isPending;
  if (isPending || (!loadError && (draft === undefined || versionPending))) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (isError || loadError) {
    return (
      <View style={styles.center}>
        <Text testID="cooking-error-text" style={styles.errorText}>
          {loadError?.message}
        </Text>
      </View>
    );
  }

  const version =
    fromAttemptId && versionQuery.data
      ? versionStart(recipe, versionQuery.data)
      : null;

  if (draft && resumeChoice === ResumeChoice.Ask) {
    const steps =
      draft.instructions ?? linesFromBase(splitLines(recipe.instructions));
    return (
      <ResumeDraftPrompt
        startedAgo={formatTimeAgo(Date.now() - draft.startedAt)}
        stepsDone={countChecked(steps, draft.checkedSteps)}
        stepsTotal={countCountable(steps)}
        onStartOver={() => {
          clearDraft(recipeId).catch(() => {
            // A draft left behind is overwritten by the next save.
          });
          setResumeChoice(ResumeChoice.StartOver);
        }}
        onResume={() => setResumeChoice(ResumeChoice.Resume)}
      />
    );
  }

  return (
    <CookingSession
      recipe={recipe}
      initialDraft={
        resumeChoice === ResumeChoice.StartOver ? null : draft ?? null
      }
      version={version}
      navigation={navigation}
    />
  );
}

// Everything that happens once the recipe (and any saved draft) is loaded.
// Progress picks up from the draft and is saved back to the phone as you go.
// Without a draft, a past version (if any) gives the starting lines.
function CookingSession({
  recipe,
  initialDraft,
  version,
  navigation,
}: {
  recipe: Recipe;
  initialDraft: CookingDraft | null;
  version: StartVersion | null;
  navigation: Props['navigation'];
}) {
  const [start] = useState(() =>
    initialDraft
      ? {
          basedOn: initialDraft.basedOnAttemptId
            ? {
                id: initialDraft.basedOnAttemptId,
                madeAt: initialDraft.basedOnMadeAt,
              }
            : null,
          ingredientLines: initialDraft.ingredients,
          stepLines: initialDraft.instructions,
        }
      : {
          basedOn: version?.basedOn ?? null,
          ingredientLines: version?.ingredientLines ?? null,
          stepLines: version?.stepLines ?? null,
        },
  );
  const basedOn = start.basedOn;
  const [startedAt] = useState(() => initialDraft?.startedAt ?? Date.now());
  // Counts active cooking time: pauses while the app is in the background
  // or you've left the screen. Shown at the top of the content.
  const [clock, setClock] = useState<CookingClock>(() =>
    initialDraft
      ? clockFromDraft(initialDraft, Date.now())
      : startClock(Date.now()),
  );
  const [checkedIngredients, setCheckedIngredients] = useState<number[]>(
    () => initialDraft?.checkedIngredients ?? [],
  );
  const [checkedSteps, setCheckedSteps] = useState<number[]>(
    () => initialDraft?.checkedSteps ?? [],
  );
  // Lines as changed for this attempt; null until the first change.
  const [ingredientLines, setIngredientLines] = useState<CookingLine[] | null>(
    start.ingredientLines,
  );
  const [stepLines, setStepLines] = useState<CookingLine[] | null>(
    start.stepLines,
  );
  const [notes, setNotes] = useState(() => initialDraft?.notes ?? '');
  const [timers, setTimers] = useState<CookingTimer[]>(
    () => initialDraft?.timers ?? [],
  );
  const [now, setNow] = useState(() => Date.now());
  // Minutes picked for a new manual timer; null while the panel is closed.
  const [newTimerMinutes, setNewTimerMinutes] = useState<number | null>(null);
  // Timers whose "done" alert has been raised, so it's raised only once.
  const alerted = useRef(new Set<string>());
  // Finished timers waiting for the done sheet, shown one at a time.
  const [doneQueue, setDoneQueue] = useState<string[]>([]);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const notesInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const notesSectionY = useRef(0);
  const stepsSectionY = useRef(0);
  const stepYs = useRef<Record<number, number>>({});

  // Until the first change, the lines are the saved recipe's.
  const ingredients = ingredientLines ?? linesFromBase(recipe.ingredients);
  const steps = stepLines ?? linesFromBase(splitLines(recipe.instructions));
  const nextStep = findNextStep(steps, checkedSteps);
  const stepNumbers = numberActiveLines(steps);

  const fields: DraftFields = {
    recipeId: recipe.id,
    basedOn,
    startedAt,
    clock,
    ingredientLines,
    stepLines,
    checkedIngredients,
    checkedSteps,
    notes,
    timers,
  };
  const latestFields = useRef(fields);
  latestFields.current = fields;
  // Once a draft exists, keep it up to date even if everything is unchecked.
  const hadDraft = useRef(initialDraft !== null);
  // Finish sheet open: the clock is stopped while you fill it in.
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(finishing);
  finishingRef.current = finishing;
  // Set once the attempt is saved or discarded: the draft is gone, nothing
  // is saved again, and the screen closes without asking.
  const done = useRef(false);
  const [closing, setClosing] = useState(false);
  const createAttempt = useCreateAttempt(recipe.id);

  // Any way out (✕ or Android back; swipe-back is off) asks first once there's
  // progress. Leaving keeps the draft: it's saved on unmount.
  const guardLeaving =
    !closing && (hadDraft.current || hasProgress(fields, start));
  usePreventRemove(guardLeaving, ({ data }) => {
    Alert.alert(strings.cooking.leaveTitle, strings.cooking.leaveMessage, [
      { text: strings.cooking.keepCooking, style: 'cancel' },
      {
        text: strings.cooking.leave,
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  // Writes the draft now; `pause` saves the clock stopped (leaving).
  const [flushDraft] = useState(() => (at: number, pause: boolean) => {
    const latest = latestFields.current;
    if (done.current) return;
    if (!hadDraft.current && !hasProgress(latest, start)) return;
    hadDraft.current = true;
    const clockToSave = pause ? pauseClock(latest.clock, at) : latest.clock;
    saveDraft(toDraft({ ...latest, clock: clockToSave }, at)).catch(() => {
      // Nothing to show while cooking; the next change tries again.
    });
  });

  // Save shortly after each change (not on every timer tick).
  useEffect(() => {
    const timeout = setTimeout(
      () => flushDraft(Date.now(), false),
      SAVE_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [
    flushDraft,
    clock,
    ingredientLines,
    stepLines,
    checkedIngredients,
    checkedSteps,
    notes,
    timers,
  ]);

  // Leaving cooking mode (✕ or back) saves at once, with the clock paused.
  useEffect(() => () => flushDraft(Date.now(), true), [flushDraft]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      const at = Date.now();
      // 'inactive' (e.g. iOS control centre) keeps counting: you're still
      // at the stove.
      if (state === 'background') {
        setClock(c => pauseClock(c, at));
        // The app may be closed from the background, so save right away.
        flushDraft(at, true);
      }
      if (state === 'active' && !finishingRef.current) {
        setClock(c => resumeClock(c, at));
      }
    });
    return () => subscription.remove();
  }, [flushDraft]);

  const [openFinish] = useState(() => () => {
    setClock(c => pauseClock(c, Date.now()));
    setFinishing(true);
  });

  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: renderFinishButton(openFinish) });
  }, [navigation, openFinish]);

  // Runs after the render that turned the leave guard off.
  useEffect(() => {
    // Back to recipe detail, also when cooking an old version from its
    // attempt detail screen.
    if (closing)
      navigation.popTo(Screens.RecipeDetail, { recipeId: recipe.id });
  }, [closing, navigation, recipe.id]);

  function closeFinish() {
    createAttempt.reset();
    setFinishing(false);
    setClock(c => resumeClock(c, Date.now()));
  }

  function endSession() {
    done.current = true;
    clearDraft(recipe.id).catch(() => {
      // A leftover draft only brings back the resume prompt next time.
    });
    setClosing(true);
  }

  function saveAttempt(values: FinishValues) {
    const ingredientTexts = ingredientLines && changedTexts(ingredientLines);
    const stepTexts = stepLines && changedTexts(stepLines);
    createAttempt.mutate(
      {
        durationMinutes: values.durationMinutes,
        rating: values.rating,
        fullness: values.fullness,
        enjoyment: values.enjoyment,
        ...(values.photo && { photo: values.photo }),
        notes: values.notes.trim() || null,
        ingredients: ingredientTexts
          ? ingredientTexts.map(text => ({ text }))
          : null,
        instructions: stepTexts ? stepTexts.join('\n') : null,
        basedOnAttemptId: basedOn?.id ?? null,
      },
      { onSuccess: endSession },
    );
  }

  function confirmDiscard() {
    Alert.alert(strings.finish.discardTitle, strings.finish.discardMessage, [
      { text: strings.common.cancel, style: 'cancel' },
      {
        text: strings.finish.discardConfirm,
        style: 'destructive',
        onPress: endSession,
      },
    ]);
  }

  function renderFinishSheet() {
    if (!finishing) return null;
    const recipeMinutes = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
    return (
      <FinishSheet
        date={formatPostedDate(new Date().toISOString())}
        durationMinutes={Math.round(elapsedMs(clock, Date.now()) / 60_000)}
        recipeMinutes={recipeMinutes > 0 ? recipeMinutes : null}
        notes={notes}
        changeSummary={changeSummary(
          countChanged(ingredients),
          countChanged(steps),
        )}
        saving={createAttempt.isPending}
        error={createAttempt.error?.message ?? null}
        onSave={saveAttempt}
        onDiscard={confirmDiscard}
        onClose={closeFinish}
      />
    );
  }

  // Tick once a second while any timer runs.
  const hasRunningTimer = timers.some(timer => !isPaused(timer));
  useEffect(() => {
    if (!hasRunningTimer) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [hasRunningTimer]);

  // "Step 2" (numbered as shown now) or "Timer 1".
  function shortLabel(timer: CookingTimer): string {
    const number =
      timer.stepIndex === undefined ? undefined : stepNumbers[timer.stepIndex];
    return number === undefined
      ? timer.label
      : strings.cooking.stepShortLabel(number);
  }

  // "Step 2 · Add tomatoes and simmer…" or "Timer 1".
  function timerLabel(timer: CookingTimer): string {
    const index = timer.stepIndex;
    const text = index === undefined ? null : steps[index]?.text;
    const number = index === undefined ? undefined : stepNumbers[index];
    return text && number !== undefined
      ? strings.cooking.stepTimerLabel(number, text)
      : timer.label;
  }

  function dropTimer(id: string) {
    alerted.current.delete(id);
    setTimers(current => removeTimer(current, id));
    setDoneQueue(current => current.filter(queued => queued !== id));
  }

  // Foreground only for now: vibrate and queue the done sheet. Background
  // alarms come with local notifications in Phase 7.
  useEffect(() => {
    const finished = timers.filter(
      timer => isFinished(timer, now) && !alerted.current.has(timer.id),
    );
    if (finished.length === 0) return;
    finished.forEach(timer => alerted.current.add(timer.id));
    Vibration.vibrate();
    setDoneQueue(current => [...current, ...finished.map(timer => timer.id)]);
  }, [timers, now]);

  function addTime(id: string, minutes: number) {
    const at = Date.now();
    alerted.current.delete(id);
    setNow(at);
    setTimers(current => restartTimer(current, id, minutes, at));
    setDoneQueue(current => current.filter(queued => queued !== id));
  }

  function checkStepFromTimer(id: string, index: number) {
    setCheckedSteps(current =>
      current.includes(index) ? current : [...current, index],
    );
    dropTimer(id);
  }

  function renderDoneSheet() {
    const timer = timers.find(t => t.id === doneQueue[0]);
    if (!timer) return null;
    const index = timer.stepIndex;
    const stepText = index === undefined ? null : steps[index]?.text;
    return (
      <TimerDoneSheet
        key={timer.id}
        title={strings.cooking.timerDone(shortLabel(timer))}
        stepText={stepText ?? undefined}
        onAddTime={minutes => addTime(timer.id, minutes)}
        onCheckStep={
          index !== undefined && stepText
            ? () => checkStepFromTimer(timer.id, index)
            : undefined
        }
        onDismiss={() => dropTimer(timer.id)}
      />
    );
  }

  function startStepTimer(index: number, number: number, minutes: number) {
    const started = Date.now();
    setNow(started);
    setTimers(current =>
      startTimer(
        current,
        {
          id: stepTimerId(index),
          stepIndex: index,
          label: strings.cooking.stepShortLabel(number),
        },
        minutes,
        started,
      ),
    );
  }

  function startManualTimer(minutes: number) {
    const started = Date.now();
    setNow(started);
    setTimers(current => {
      const { id, number } = nextManualTimer(current);
      return startTimer(
        current,
        { id, label: strings.cooking.manualTimerLabel(number) },
        minutes,
        started,
      );
    });
    setNewTimerMinutes(null);
  }

  function togglePause(id: string) {
    const at = Date.now();
    setNow(at);
    setTimers(current => {
      const timer = current.find(t => t.id === id);
      if (!timer) return current;
      return isPaused(timer)
        ? resumeTimer(current, id, at)
        : pauseTimer(current, id, at);
    });
  }

  // A step that mentions a time gets a "⏱ 10 min" chip; once started, the
  // chip shows the countdown and can't start a second timer.
  function renderStepTimer(index: number, number: number) {
    const timer = timers.find(t => t.id === stepTimerId(index));
    const minutes = detectDurationMinutes(steps[index].text ?? '');

    if (timer) {
      const remaining = formatRemaining(remainingMs(timer, now));
      return (
        <View
          testID={`cooking-step-timer-${index}`}
          accessible
          accessibilityLabel={strings.cooking.timerRemaining(
            shortLabel(timer),
            remaining,
          )}
          style={[styles.timerChip, styles.timerChipRunning]}
        >
          <Text style={styles.timerChipText}>
            {isPaused(timer)
              ? strings.cooking.stepTimerPaused(remaining)
              : strings.cooking.stepTimerRunning(remaining)}
          </Text>
        </View>
      );
    }

    if (minutes === null) return null;
    return (
      <Pressable
        testID={`cooking-step-timer-${index}`}
        accessibilityRole="button"
        accessibilityLabel={strings.cooking.startStepTimer(number, minutes)}
        style={styles.timerChip}
        onPress={() => startStepTimer(index, number, minutes)}
      >
        <Text style={styles.timerChipText}>
          {strings.cooking.stepTimerChip(minutes)}
        </Text>
      </Pressable>
    );
  }

  function toggleStep(index: number) {
    const updated = toggle(checkedSteps, index);
    setCheckedSteps(updated);
    // Only move the view forward when a step gets checked, never on uncheck.
    if (updated.length < checkedSteps.length) return;
    const next = findNextStep(steps, updated);
    const y = stepYs.current[next];
    if (next === -1 || y === undefined) return;
    scrollRef.current?.scrollTo({
      y: stepsSectionY.current + y - 16,
      animated: true,
    });
  }

  function startStepNote(stepNumber: number) {
    setNotes(current => addStepNotePrefix(current, stepNumber));
    scrollRef.current?.scrollTo({
      y: notesSectionY.current - 16,
      animated: true,
    });
    notesInputRef.current?.focus();
  }

  // The title lives in the header; timers stay pinned above the recipe.
  return (
    <View style={styles.screen}>
      <TimerStack
        timers={sortBySoonest(timers, now)}
        now={now}
        labelFor={timerLabel}
        onTogglePause={togglePause}
        onRemove={dropTimer}
      />
      {renderDoneSheet()}
      {renderFinishSheet()}
      <ScrollView
        ref={scrollRef}
        testID="cooking-scroll"
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.content}>
          {basedOn?.madeAt ? (
            <Text testID="cooking-based-on-banner" style={styles.banner}>
              {strings.cooking.basedOnBanner(formatShortDate(basedOn.madeAt))}
            </Text>
          ) : null}
          <CookingClockText clock={clock} />
          <CookingChecklist
            kind={LineKind.Ingredient}
            title={strings.cooking.ingredientsHeading}
            progress={strings.cooking.ingredientsProgress(
              countChecked(ingredients, checkedIngredients),
              countCountable(ingredients),
            )}
            addLabel={strings.cooking.addIngredient}
            lines={ingredients}
            checked={checkedIngredients}
            onToggle={index =>
              setCheckedIngredients(current => toggle(current, index))
            }
            onChangeLines={setIngredientLines}
          />

          <CookingChecklist
            kind={LineKind.Step}
            title={strings.cooking.stepsHeading}
            progress={strings.cooking.stepsProgress(
              countChecked(steps, checkedSteps),
              countCountable(steps),
            )}
            addLabel={strings.cooking.addStep}
            lines={steps}
            checked={checkedSteps}
            highlighted={nextStep}
            style={styles.stepsSection}
            onToggle={toggleStep}
            onChangeLines={setStepLines}
            onLayout={y => {
              stepsSectionY.current = y;
            }}
            onRowLayout={(index, y) => {
              stepYs.current[index] = y;
            }}
            onNote={startStepNote}
            renderExtra={renderStepTimer}
          />

          {newTimerMinutes === null ? (
            <Pressable
              testID="cooking-add-timer-button"
              accessibilityRole="button"
              style={styles.addTimerButton}
              onPress={() => setNewTimerMinutes(DEFAULT_TIMER_MINUTES)}
            >
              <Text style={styles.addTimerText}>
                {strings.cooking.addTimer}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.newTimerPanel}>
              <MinutesStepper
                testIDPrefix="cooking-new-timer"
                value={newTimerMinutes}
                onChange={setNewTimerMinutes}
              />
              <View style={styles.newTimerActions}>
                <Pressable
                  testID="cooking-new-timer-cancel-button"
                  accessibilityRole="button"
                  style={styles.panelButton}
                  onPress={() => setNewTimerMinutes(null)}
                >
                  <Text style={styles.panelButtonText}>
                    {strings.common.cancel}
                  </Text>
                </Pressable>
                <Pressable
                  testID="cooking-new-timer-start-button"
                  accessibilityRole="button"
                  style={[styles.panelButton, styles.startButton]}
                  onPress={() => startManualTimer(newTimerMinutes)}
                >
                  <Text style={[styles.panelButtonText, styles.startText]}>
                    {strings.cooking.startTimer}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          <View
            style={styles.notesSection}
            onLayout={event => {
              notesSectionY.current = event.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.notesHeading}>
              {strings.cooking.notesHeading}
            </Text>
            <TextInput
              ref={notesInputRef}
              testID="cooking-notes-input"
              accessibilityLabel={strings.cooking.notesHeading}
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder={strings.cooking.notesPlaceholder}
              placeholderTextColor={colors.placeholderText}
              multiline
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scroll: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.paper,
  },
  errorText: {
    fontFamily: fonts.serif,
    fontSize: 17,
    color: colors.ink,
    textAlign: 'center',
  },
  banner: {
    marginBottom: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
    textAlign: 'center',
  },
  finishText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.accent,
  },
  exitText: {
    fontSize: 22,
    color: colors.ink,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 48,
  },
  stepsSection: {
    marginTop: 32,
  },
  timerChip: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  timerChipRunning: {
    backgroundColor: colors.paper,
  },
  timerChipText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  addTimerButton: {
    minHeight: 56,
    justifyContent: 'center',
    paddingLeft: 16,
  },
  addTimerText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.ink,
  },
  newTimerPanel: {
    marginTop: 8,
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  newTimerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  panelButton: {
    minHeight: 48,
    minWidth: 88,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.ink,
  },
  startButton: {
    backgroundColor: colors.accent,
  },
  startText: {
    color: colors.card,
  },
  notesSection: {
    marginTop: 32,
  },
  notesHeading: {
    paddingBottom: 8,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: colors.ink,
  },
  notesInput: {
    minHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    fontSize: 18,
    lineHeight: 26,
    color: colors.ink,
    textAlignVertical: 'top',
  },
});

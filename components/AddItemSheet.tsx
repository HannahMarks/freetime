import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createBusyBlock,
  createUnavailableDay,
  deleteBusyBlock,
  deleteUnavailableDay,
  skipBusyBlockOccurrence,
  updateBusyBlock,
  updateUnavailableDay,
} from '../lib/availability-actions';
import { CalendarItem, formatTimeRange } from '../lib/calendar-helpers';
import type { RecurrenceRule } from '../lib/recurrence';
import { toast } from '../lib/toast';
import { DatePicker } from './DatePicker';
import { TimePicker } from './TimePicker';

const SCREEN_HEIGHT = Dimensions.get('window').height;
/** 0 = full-screen modal. The sheet covers everything edge-to-edge. */
const SHEET_TOP_OFFSET = 0;
const ENTER_DURATION_MS = 280;
/** Used by the visibility-driven exit animation when the sheet is being
 * dismissed by means OTHER than a swipe (Close button, backdrop tap).
 * The swipe-dismiss path drives its own withTiming inline, sized to feel
 * continuous with the user's gesture velocity. */
const EXIT_DURATION_MS = 220;
/** Faded color for placeholder text + the "(optional)" hint inside inputs. */
const PLACEHOLDER_COLOR = '#b5b5b5';
/** Initial scale for the entry animation. The user's request shifted from
 * "more zoom" → "more slide-up than zoom", so this is now subtle (0.96):
 * the slide is the dominant motion, and the small scale-up just gives the
 * sheet a hint of forward depth as it lands. */
const ENTRY_SCALE_FROM = 0.96;

/** 2-letter chip labels for the day-of-week multi-picker, indexed by
 * `Date#getDay()` (0=Sun…6=Sat). 2 letters keeps the seven chips
 * comfortably across one row on phone widths; full names below are used
 * for accessibility labels. */
const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEKDAY_FULL_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

type Kind = 'busy' | 'unavailable';

type Props = {
  visible: boolean;
  selectedDate: string; // YYYY-MM-DD
  /**
   * If set, the sheet pre-fills with this item. Tapping an existing item
   * opens this sheet in *view* mode (read-only details). Tapping the
   * pencil button switches to edit mode (form). Save calls update;
   * the three-dots menu offers Copy / Delete.
   */
  editing?: CalendarItem | null;
  onClose: () => void;
  /** Fires after a successful save OR delete. Parent should refetch. */
  onSaved: () => void;
};

/** Build a Date for the selected day at the given local hour:minute. */
function buildDate(dateStr: string, hour: number, minute: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}

/** Replace the year/month/day of `prev` with those of `picked`, preserving
 * `prev`'s hour and minute. Used so picking a date doesn't clobber the
 * already-picked time. */
function withDate(prev: Date, picked: Date): Date {
  return new Date(
    picked.getFullYear(),
    picked.getMonth(),
    picked.getDate(),
    prev.getHours(),
    prev.getMinutes(),
    0,
    0,
  );
}

/** Replace the hour/minute of `prev` with those of `picked`, preserving
 * `prev`'s date. */
function withTime(prev: Date, picked: Date): Date {
  return new Date(
    prev.getFullYear(),
    prev.getMonth(),
    prev.getDate(),
    picked.getHours(),
    picked.getMinutes(),
    0,
    0,
  );
}

/** Local-zone YYYY-MM-DD for a Date. Mirrors `lib/calendar-helpers.ts`'s
 * `isoDate` — kept inline to avoid a one-helper import dependency. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string into a local-zone Date at midnight. The
 * `until` field uses YYYY-MM-DD so the day boundary is timezone-stable
 * for the user. */
function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Build the view-mode recurrence summary string from a rule. Examples:
 * - `{freq:'weekly'}` + Mon base → "Weekly on Monday"
 * - `{freq:'weekly', byDay:[1,3,5]}` → "Weekly on Mon, Wed, Fri"
 * - `{freq:'weekly', byDay:[1], until:'2026-12-31'}` → "Weekly on Monday until Dec 31, 2026"
 *
 * Pure (no JSX, no React) so it's trivial to unit-test if we ever do.
 * Locale-aware via `Intl.DateTimeFormat`. */
function summarizeRecurrence(rule: RecurrenceRule, baseStart: Date): string {
  const baseWeekday = baseStart.getDay();
  const days =
    rule.byDay && rule.byDay.length > 0 ? [...rule.byDay] : [baseWeekday];
  days.sort((a, b) => a - b);

  // Single day → use the full weekday name; multiple → 3-letter abbrevs
  // separated by commas. Keeps the line scannable in both common cases.
  let dayPart: string;
  if (days.length === 1) {
    dayPart = WEEKDAY_FULL_NAMES[days[0]];
  } else {
    const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayPart = days.map((d) => SHORT[d]).join(', ');
  }

  let summary = `Weekly on ${dayPart}`;
  if (rule.until) {
    const untilDate = parseIsoDate(rule.until);
    summary += ` until ${new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(untilDate)}`;
  }
  return summary;
}

/** Format a single date as "Wednesday, May 13, 2026" for view mode. */
function formatLongDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/**
 * Full-page modal for viewing, editing, or creating a busy_block /
 * unavailable_day.
 *
 * Three modes determined by props + state:
 *   - **Create** (no `editing` prop): heading "Add to your day", form body,
 *     Save button, kind toggle visible.
 *   - **View** (`editing` set, `formMode` false — default when opened):
 *     heading shows the event title, body shows read-only details
 *     (date / time / location / notes). Pencil button + three-dots menu
 *     in the header. No Save button.
 *   - **Edit** (`editing` set, `formMode` true — entered via pencil tap):
 *     heading "Edit", form body pre-filled, Save button.
 */
export function AddItemSheet({ visible, selectedDate, editing, onClose, onSaved }: Props) {
  const editingKind: Kind | null = editing
    ? editing.kind === 'busy_block'
      ? 'busy'
      : 'unavailable'
    : null;

  const [kind, setKind] = useState<Kind>(editingKind ?? 'busy');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // True = render the form (inputs); false = render read-only details.
  // For an existing item, defaults to view (false) — the user has to tap
  // the pencil to start editing. Creation mode (no `editing`) is always
  // form-mode.
  const [formMode, setFormMode] = useState<boolean>(!editing);
  // Custom popover menu state — opens below the three-dots button.
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  // Repeat-weekly toggle. When ON, the form expands to show day-of-week
  // chips + an "until" date picker. The toggle being OFF means a one-off
  // (recurrenceRule = null on save). Always false in unavailable-day
  // mode — recurring all-day markers are out of scope for v2.
  const [repeatWeekly, setRepeatWeekly] = useState<boolean>(false);
  // Selected weekdays (0=Sun…6=Sat). Empty array = "use the base's
  // weekday" (the helper falls back to that). Multi-select chips below
  // the toggle let the user pick "Mon, Wed, Fri"-style schedules. When
  // the user toggles "Repeat weekly" on at create-time we pre-select
  // the weekday of `start` so the rule isn't accidentally empty.
  const [byDay, setByDay] = useState<number[]>([]);
  // Optional end-of-series date as YYYY-MM-DD. null = no `until` clause
  // (the series repeats indefinitely; the helper still bounds expansion
  // to the requested query window).
  const [until, setUntil] = useState<string | null>(null);

  const initialStart = useMemo(() => {
    if (editing?.kind === 'busy_block') return editing.startsAt;
    return buildDate(selectedDate, 9, 0);
  }, [editing, selectedDate]);
  const initialEnd = useMemo(() => {
    if (editing?.kind === 'busy_block') return editing.endsAt;
    return buildDate(selectedDate, 10, 0);
  }, [editing, selectedDate]);

  const [start, setStart] = useState<Date>(initialStart);
  const [end, setEnd] = useState<Date>(initialEnd);

  // `rendered` lags behind `visible` so we can play an exit animation
  // before the Modal actually unmounts. Mount immediately on open;
  // unmount only after the slide-down completes.
  const [rendered, setRendered] = useState<boolean>(visible);
  const translateY = useSharedValue(visible ? 0 : SCREEN_HEIGHT);
  const scale = useSharedValue(visible ? 1 : ENTRY_SCALE_FROM);
  const backdropOpacity = useSharedValue(visible ? 0.4 : 0);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      // Slide-up + zoom-in. BOTH springs are critically damped now
      // (no overshoot) — the user reported the bouncy version felt
      // wrong on landing. The 0.7 → 1 scale + slide-up still reads as
      // a clear bloom, just without the wobble at the end.
      translateY.value = withSpring(0, {
        damping: 24,
        stiffness: 220,
        mass: 0.9,
      });
      scale.value = withSpring(1, {
        damping: 22,
        stiffness: 220,
        mass: 0.9,
      });
      backdropOpacity.value = withTiming(0.4, {
        duration: ENTER_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
    } else if (rendered) {
      // Easing.out (NOT Easing.in) on the way out: starts moving fast
      // immediately and decelerates. Easing.in does the opposite — it
      // sits still for the first half of the animation, which felt
      // jerky after a fast tap on Close (and ESPECIALLY jerky if a
      // swipe-dismiss has already kicked off momentum, because the
      // visibility-driven animation would brake before continuing).
      translateY.value = withTiming(
        SCREEN_HEIGHT,
        { duration: EXIT_DURATION_MS, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setRendered)(false);
        },
      );
      scale.value = withTiming(ENTRY_SCALE_FROM, {
        duration: EXIT_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
      backdropOpacity.value = withTiming(0, {
        duration: EXIT_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [visible, rendered, translateY, scale, backdropOpacity]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  // Tracks the translationY at gesture activation. Without this, the
  // sheet would teleport down by `minDistance` pixels the instant the
  // gesture activates (since the gesture's translationY is cumulative
  // from touch-start, not from activation). Subtracting the activation
  // offset means the sheet's motion is continuous with the finger.
  const dismissActivationY = useSharedValue(0);

  // Swipe-down to dismiss. minDistance(6) is a small enough activation
  // distance to feel responsive while still ignoring micro-jitters; we
  // also subtract the activation translation to avoid a jump-on-activate.
  // The dismiss path drives its OWN withTiming so the off-screen slide
  // continues at the user's gesture velocity instead of being braked by
  // a visibility-driven exit animation.
  const dismissPan = Gesture.Pan()
    .minDistance(6)
    .onStart((e) => {
      dismissActivationY.value = e.translationY;
    })
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY - dismissActivationY.value);
    })
    .onEnd((e) => {
      const shouldDismiss =
        e.translationY > SCREEN_HEIGHT * 0.18 || e.velocityY > 450;
      if (shouldDismiss) {
        // Continue the slide off-screen smoothly, THEN call onClose.
        // Calling onClose immediately would trigger the visibility
        // effect's withTiming, which competes with the gesture
        // velocity and produces a perceptible stutter at hand-off.
        // Once translateY hits SCREEN_HEIGHT, the visibility effect's
        // animation is a no-op (it's already there).
        translateY.value = withTiming(
          SCREEN_HEIGHT,
          { duration: 240, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (finished) runOnJS(onClose)();
          },
        );
        backdropOpacity.value = withTiming(0, {
          duration: 240,
          easing: Easing.out(Easing.cubic),
        });
        scale.value = withTiming(ENTRY_SCALE_FROM, {
          duration: 240,
          easing: Easing.out(Easing.cubic),
        });
      } else {
        // Critically-damped spring back — no bobbing, no overshoot.
        translateY.value = withSpring(0, {
          damping: 28,
          stiffness: 200,
          mass: 0.9,
        });
      }
    });

  // Reset whenever the sheet (re-)opens or the editing target changes.
  useEffect(() => {
    if (visible) {
      setKind(editingKind ?? 'busy');
      setTitle(editing?.title ?? '');
      setLocation(editing?.kind === 'busy_block' ? (editing.location ?? '') : '');
      setNotes(editing?.notes ?? '');
      setStart(initialStart);
      setEnd(initialEnd);
      setFormMode(!editing);
      setMenuOpen(false);
      // Pre-fill recurrence from the editing item — both kinds carry
      // recurrenceRule now (busy_blocks since v1, unavailable_days
      // since v3).
      const editingRule =
        editing?.kind === 'busy_block'
          ? editing.recurrenceRule
          : editing?.kind === 'unavailable_day'
            ? editing.recurrenceRule
            : null;
      setRepeatWeekly(editingRule != null);
      setByDay(editingRule?.byDay ?? []);
      setUntil(editingRule?.until ?? null);
    }
  }, [visible, editing, editingKind, initialStart, initialEnd]);

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const trimmedTitle = title.trim() || null;
      const trimmedLocation = location.trim() || null;
      const trimmedNotes = notes.trim() || null;
      if (kind === 'busy') {
        if (end <= start) {
          toast.error('End time must be after start time.');
          return;
        }
        // Project the toggle + chips + until-date into the storage
        // shape. Empty byDay → omitted (helper falls back to the base's
        // weekday). Null until → omitted (series repeats indefinitely).
        let recurrenceRule: RecurrenceRule | null = null;
        if (repeatWeekly) {
          recurrenceRule = { freq: 'weekly' };
          if (byDay.length > 0) recurrenceRule.byDay = [...byDay].sort((a, b) => a - b);
          if (until) recurrenceRule.until = until;
        }
        const { error } =
          editing?.kind === 'busy_block'
            ? await updateBusyBlock({
                id: editing.id,
                startsAt: start,
                endsAt: end,
                title: trimmedTitle,
                notes: trimmedNotes,
                location: trimmedLocation,
                recurrenceRule,
              })
            : await createBusyBlock({
                startsAt: start,
                endsAt: end,
                title: trimmedTitle,
                notes: trimmedNotes,
                location: trimmedLocation,
                recurrenceRule,
              });
        if (error) {
          toast.error(error);
          return;
        }
      } else {
        // Same recurrence projection as the busy branch — empty byDay
        // → omitted, null until → omitted, repeatWeekly off → null
        // (one-off).
        let recurrenceRule: RecurrenceRule | null = null;
        if (repeatWeekly) {
          recurrenceRule = { freq: 'weekly' };
          if (byDay.length > 0) recurrenceRule.byDay = [...byDay].sort((a, b) => a - b);
          if (until) recurrenceRule.until = until;
        }
        const { error } =
          editing?.kind === 'unavailable_day'
            ? await updateUnavailableDay({
                userId: editing.user.id,
                // For an expanded occurrence, `editing.date` is the
                // OCCURRENCE date — fall back to the seriesDate so the
                // (user_id, date) PK lookup hits the underlying row.
                date: editing.seriesDate ?? editing.date,
                title: trimmedTitle,
                notes: trimmedNotes,
                recurrenceRule,
              })
            : await createUnavailableDay({
                date: selectedDate,
                title: trimmedTitle,
                notes: trimmedNotes,
                recurrenceRule,
              });
        if (error) {
          toast.error(error);
          return;
        }
      }
      onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    setMenuOpen(false);
    if (!editing || editing.kind !== 'busy_block' || submitting) return;
    setSubmitting(true);
    try {
      const { error } = await createBusyBlock({
        startsAt: editing.startsAt,
        endsAt: editing.endsAt,
        title: editing.title,
        notes: editing.notes,
        location: editing.location,
      });
      if (error) {
        toast.error(error);
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  function handleMore() {
    if (!editing || submitting) return;
    setMenuOpen((v) => !v);
  }

  function handleEdit() {
    if (!editing || submitting) return;
    setMenuOpen(false);
    setFormMode(true);
  }

  function handleDelete() {
    setMenuOpen(false);
    if (!editing || submitting) return;
    // For a recurring busy_block, "Delete event" means delete the
    // entire SERIES (the popover offers a separate "Delete this
    // occurrence" entry that writes a skip exception instead). Make
    // the confirmation copy clear about which one's about to happen.
    const isRecurringBusy =
      editing.kind === 'busy_block' && !!editing.recurrenceRule;
    const confirmTitle = isRecurringBusy
      ? 'Delete the entire series?'
      : 'Delete this item?';
    Alert.alert(confirmTitle, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSubmitting(true);
          try {
            const { error } =
              editing.kind === 'busy_block'
                ? await deleteBusyBlock(editing.id)
                : await deleteUnavailableDay({
                    userId: editing.user.id,
                    // For a recurring unavailable_day occurrence, the
                    // PK is `(user_id, seriesDate)` — fall back to
                    // `date` for one-offs (where the two are equal).
                    date: editing.seriesDate ?? editing.date,
                  });
            if (error) {
              toast.error(error);
              return;
            }
            onSaved();
            onClose();
          } finally {
            setSubmitting(false);
          }
        },
      },
    ]);
  }

  /** Skip just THIS occurrence of a recurring busy_block series. The
   * series row stays put — only the tapped occurrence's date is hidden
   * from `listCalendarItems` going forward. v4 supports skip on
   * busy_blocks only; recurring unavailable_day exceptions ship in a
   * follow-up. */
  function handleSkipOccurrence() {
    setMenuOpen(false);
    if (!editing || submitting || editing.kind !== 'busy_block') return;
    if (!editing.recurrenceRule) return;
    Alert.alert('Delete this occurrence?', 'The rest of the series will stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSubmitting(true);
          try {
            const { error } = await skipBusyBlockOccurrence({
              seriesId: editing.id,
              originalStart: editing.startsAt,
            });
            if (error) {
              toast.error(error);
              return;
            }
            onSaved();
            onClose();
          } finally {
            setSubmitting(false);
          }
        },
      },
    ]);
  }

  const inViewMode = !!editing && !formMode;
  // View mode shows the user's own title only — when there's no title we
  // render an empty heading area rather than falling back to "Busy time"
  // (the date / time / location / notes lines below carry the meaning).
  const heading = !editing
    ? 'Add to your day'
    : inViewMode
      ? (editing.title ?? '')
      : 'Edit';

  // Read-only display strings for view mode.
  const viewTimeRange = useMemo(() => {
    if (!editing) return null;
    if (editing.kind === 'busy_block') {
      return formatTimeRange(editing.startsAt, editing.endsAt);
    }
    return 'All day';
  }, [editing]);

  const viewDate = useMemo(() => {
    if (!editing) return null;
    if (editing.kind === 'busy_block') {
      return formatLongDate(editing.startsAt);
    }
    const [y, m, d] = editing.date.split('-').map(Number);
    return formatLongDate(new Date(y, m - 1, d));
  }, [editing]);

  return (
    <Modal
      visible={rendered}
      animationType="none"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      {/* Backdrop fades in/out behind the sheet — tap to dismiss. */}
      <Animated.View
        pointerEvents={rendered ? 'auto' : 'none'}
        style={[styles.backdrop, backdropStyle]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Dismiss backdrop"
        />
      </Animated.View>
      {/* Sheet slides up from below via spring. Wrapped in a
          GestureDetector so the user can swipe it down to dismiss
          (Pan only activates on a clearly downward drag — vertical
          scroll inside the form is unaffected by smaller motions). */}
      <GestureDetector gesture={dismissPan}>
      <Animated.View style={[styles.sheet, sheetStyle]} collapsable={false}>
        <SafeAreaView style={styles.container} testID="add-item-sheet">
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
          >
            <Text style={styles.closeIcon}>×</Text>
          </Pressable>
          <Text style={styles.heading} numberOfLines={1}>{heading}</Text>
          {editing ? (
            <View style={styles.headerRight}>
              {inViewMode ? (
                <Pressable
                  onPress={handleEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Edit"
                  testID="event-edit"
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.headerIconButton,
                    pressed && styles.headerIconButtonPressed,
                  ]}
                >
                  {/* Manual-drawn pencil icon — simple line-drawing
                      style (rectangular body + triangular tip), rotated
                      -45° so it reads as a tilted pencil. The text-glyph
                      (U+270F) version was inconsistent across platforms
                      — sometimes too thin, sometimes the wrong shape.
                      This composite always renders identically. */}
                  <View style={styles.pencilIcon}>
                    <View style={styles.pencilBody} />
                    <View style={styles.pencilTip} />
                  </View>
                </Pressable>
              ) : null}
              <Pressable
                onPress={handleMore}
                accessibilityRole="button"
                accessibilityLabel="Event actions"
                testID="event-more-actions"
                hitSlop={12}
                style={({ pressed }) => [
                  styles.headerIconButton,
                  pressed && styles.headerIconButtonPressed,
                ]}
              >
                <Text style={styles.moreIcon}>⋯</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          {inViewMode ? (
            <ScrollView contentContainerStyle={styles.viewBody}>
              <View style={styles.viewRow}>
                <Text style={styles.viewLabel}>When</Text>
                <Text style={styles.viewValue} testID="view-date">{viewDate}</Text>
                <Text style={styles.viewValue} testID="view-time">{viewTimeRange}</Text>
              </View>
              {editing?.recurrenceRule ? (
                // Compose the recurrence summary from the rule's byDay
                // and until fields. Empty/missing byDay → falls back to
                // the base's weekday. Missing until → no end-date
                // suffix. Works for both busy_blocks (uses startsAt as
                // the "base date" reference) and unavailable_days
                // (parses the YYYY-MM-DD `date` field for the same).
                <View style={styles.viewRow}>
                  <Text style={styles.viewLabel}>Repeats</Text>
                  <Text style={styles.viewValue} testID="view-recurrence">
                    {summarizeRecurrence(
                      editing.recurrenceRule,
                      editing.kind === 'busy_block'
                        ? editing.startsAt
                        : parseIsoDate(editing.seriesDate ?? editing.date),
                    )}
                  </Text>
                </View>
              ) : null}
              {editing && editing.kind === 'busy_block' && editing.location ? (
                <View style={styles.viewRow}>
                  <Text style={styles.viewLabel}>Location</Text>
                  <Text style={styles.viewValue} testID="view-location">
                    {editing.location}
                  </Text>
                </View>
              ) : null}
              {editing?.notes ? (
                <View style={styles.viewRow}>
                  <Text style={styles.viewLabel}>Notes</Text>
                  <Text style={styles.viewValue} testID="view-notes">{editing.notes}</Text>
                </View>
              ) : null}
            </ScrollView>
          ) : (
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
            >
              {!editing ? (
                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => setKind('busy')}
                    accessibilityRole="button"
                    accessibilityLabel="Add busy time"
                    testID="kind-busy"
                    style={[styles.toggle, kind === 'busy' && styles.toggleSelected]}
                  >
                    <Text style={kind === 'busy' ? styles.toggleLabelSelected : styles.toggleLabel}>
                      Busy time
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setKind('unavailable')}
                    accessibilityRole="button"
                    accessibilityLabel="Mark whole day unavailable"
                    testID="kind-unavailable"
                    style={[styles.toggle, kind === 'unavailable' && styles.toggleSelected]}
                  >
                    <Text style={kind === 'unavailable' ? styles.toggleLabelSelected : styles.toggleLabel}>
                      Unavailable all day
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.field}>
                <TextInput
                  testID="input-title"
                  placeholder="Title (optional)"
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  style={styles.input}
                  value={title}
                  onChangeText={setTitle}
                />
              </View>

              {kind === 'busy' ? (
                <>
                  <View style={styles.timeRow}>
                    <Text style={styles.label}>Starts</Text>
                    <View style={styles.pickerGroup}>
                      <DatePicker
                        testID="date-picker-start"
                        value={start}
                        onChange={(picked) => setStart((prev) => withDate(prev, picked))}
                      />
                      <TimePicker
                        testID="time-picker-start"
                        value={start}
                        onChange={(picked) => setStart((prev) => withTime(prev, picked))}
                      />
                    </View>
                  </View>
                  <View style={styles.timeRow}>
                    <Text style={styles.label}>Ends</Text>
                    <View style={styles.pickerGroup}>
                      <DatePicker
                        testID="date-picker-end"
                        value={end}
                        onChange={(picked) => setEnd((prev) => withDate(prev, picked))}
                      />
                      <TimePicker
                        testID="time-picker-end"
                        value={end}
                        onChange={(picked) => setEnd((prev) => withTime(prev, picked))}
                      />
                    </View>
                  </View>

                  <View style={styles.field}>
                    <TextInput
                      testID="input-location"
                      placeholder="Location (optional)"
                      placeholderTextColor={PLACEHOLDER_COLOR}
                      style={styles.input}
                      value={location}
                      onChangeText={setLocation}
                    />
                  </View>
                </>
              ) : null}

              {/* Recurrence section. Same UI for busy + unavailable
                  modes — recurring all-day markers ("every Sunday I'm
                  unavailable") use the same `recurrence_rule` shape +
                  `expandOccurrences` helper as recurring busy blocks.
                  Hand-rolled mini-switch (not RN's Switch) keeps the
                  off / on visuals monochrome. Toggling Repeat on for
                  the first time auto-seeds `byDay` with the start's
                  weekday so the chip row isn't visually empty. */}
              <Pressable
                onPress={() => {
                  setRepeatWeekly((v) => {
                    const next = !v;
                    if (next && byDay.length === 0) {
                      setByDay([start.getDay()]);
                    }
                    return next;
                  });
                }}
                accessibilityRole="switch"
                accessibilityState={{ checked: repeatWeekly }}
                accessibilityLabel="Repeat weekly"
                testID="repeat-weekly-toggle"
                style={({ pressed }) => [
                  styles.repeatRow,
                  pressed && styles.repeatRowPressed,
                ]}
              >
                <Text style={styles.repeatLabel}>Repeat weekly</Text>
                <View
                  style={[
                    styles.repeatSwitch,
                    repeatWeekly && styles.repeatSwitchOn,
                  ]}
                >
                  <View
                    style={[
                      styles.repeatSwitchKnob,
                      repeatWeekly && styles.repeatSwitchKnobOn,
                    ]}
                  />
                </View>
              </Pressable>

              {repeatWeekly ? (
                <>
                  {/* Day-of-week multi-picker. 7 chips, tap to toggle
                      that weekday in/out of `byDay`. Empty selection
                      saves as no `byDay` (helper falls back to the
                      base block's weekday). */}
                  <View style={styles.dayChipRow} testID="byday-chips">
                    {WEEKDAY_LABELS.map((label, dayIdx) => {
                      const selected = byDay.includes(dayIdx);
                      return (
                        <Pressable
                          key={dayIdx}
                          onPress={() => {
                            setByDay((prev) =>
                              prev.includes(dayIdx)
                                ? prev.filter((d) => d !== dayIdx)
                                : [...prev, dayIdx],
                            );
                          }}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected }}
                          accessibilityLabel={`Repeat on ${WEEKDAY_FULL_NAMES[dayIdx]}`}
                          testID={`byday-${dayIdx}`}
                          style={[
                            styles.dayChip,
                            selected && styles.dayChipSelected,
                          ]}
                        >
                          <Text
                            style={
                              selected
                                ? styles.dayChipLabelSelected
                                : styles.dayChipLabel
                            }
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Optional end-of-series date. */}
                  <Pressable
                    onPress={() => {
                      if (until) {
                        setUntil(null);
                      } else {
                        const def = new Date(start);
                        def.setMonth(def.getMonth() + 1);
                        setUntil(toIsoDate(def));
                      }
                    }}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: until != null }}
                    accessibilityLabel="Set an end date"
                    testID="until-toggle"
                    style={({ pressed }) => [
                      styles.repeatRow,
                      pressed && styles.repeatRowPressed,
                    ]}
                  >
                    <Text style={styles.repeatLabel}>Ends on a date</Text>
                    <View
                      style={[
                        styles.repeatSwitch,
                        until != null && styles.repeatSwitchOn,
                      ]}
                    >
                      <View
                        style={[
                          styles.repeatSwitchKnob,
                          until != null && styles.repeatSwitchKnobOn,
                        ]}
                      />
                    </View>
                  </Pressable>

                  {until ? (
                    <View style={styles.untilRow}>
                      <Text style={styles.label}>Ends</Text>
                      <DatePicker
                        testID="until-picker"
                        value={parseIsoDate(until)}
                        onChange={(picked) => setUntil(toIsoDate(picked))}
                      />
                    </View>
                  ) : null}
                </>
              ) : null}

              <View style={styles.field}>
                <TextInput
                  testID="input-notes"
                  placeholder="Notes (optional)"
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  style={[styles.input, styles.notesInput]}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>

        {!inViewMode ? (
          <View style={styles.footer}>
            <Pressable
              onPress={handleSave}
              accessibilityRole="button"
              accessibilityLabel="Save"
              disabled={submitting}
              style={({ pressed }) => [
                styles.save,
                pressed && styles.savePressed,
                submitting && styles.saveDisabled,
              ]}
            >
              <Text style={styles.saveLabel}>{submitting ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Custom popover for the three-dots menu. Rendered LAST inside the
            sheet so it stacks above the form/footer. The transparent
            full-area Pressable behind the menu lets a tap anywhere outside
            close the menu without dismissing the sheet itself. */}
        {menuOpen && editing ? (
          <>
            <Pressable
              style={styles.menuScrim}
              onPress={() => setMenuOpen(false)}
              accessibilityLabel="Close menu"
              testID="event-menu-scrim"
            />
            <View style={styles.menuPopover} testID="event-menu">
              {editing.kind === 'busy_block' ? (
                <Pressable
                  onPress={handleCopy}
                  accessibilityRole="button"
                  accessibilityLabel="Copy event"
                  testID="event-menu-copy"
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                >
                  <Text style={styles.menuItemLabel}>Copy event</Text>
                </Pressable>
              ) : null}
              {editing.kind === 'busy_block' && editing.recurrenceRule ? (
                // Recurring busy_blocks get TWO delete options: just
                // this occurrence (writes a skip exception) or the
                // entire series (deletes the base row + cascades
                // exceptions). Without splitting these the user has no
                // way to surgically remove a single Wednesday from
                // their "every Wed" yoga series.
                <Pressable
                  onPress={handleSkipOccurrence}
                  accessibilityRole="button"
                  accessibilityLabel="Delete this occurrence"
                  testID="event-menu-skip"
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                >
                  <Text style={[styles.menuItemLabel, styles.menuItemDanger]}>
                    Delete this occurrence
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={handleDelete}
                accessibilityRole="button"
                accessibilityLabel={
                  editing.kind === 'busy_block' && editing.recurrenceRule
                    ? 'Delete entire series'
                    : 'Delete event'
                }
                testID="event-menu-delete"
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              >
                <Text style={[styles.menuItemLabel, styles.menuItemDanger]}>
                  {editing.kind === 'busy_block' && editing.recurrenceRule
                    ? 'Delete entire series'
                    : 'Delete event'}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </SafeAreaView>
      </Animated.View>
      </GestureDetector>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  sheet: {
    position: 'absolute',
    top: SHEET_TOP_OFFSET,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    // Edge-to-edge: no rounded top, no shadow — the sheet covers the
    // whole screen so nothing peeks behind it. (Old SHEET_TOP_OFFSET=60
    // version DID have rounded corners + shadow; with offset=0 those
    // would just be invisible borders against the screen edge.)
    overflow: 'hidden',
  },
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    // Big top padding (52) so the X / pencil / ⋯ row sits well below
    // the SafeAreaView's status-bar inset. 28 left them feeling cramped
    // against the notch on phones with bigger safe areas; 52 reads as
    // a deliberate gap between the system chrome and the sheet chrome.
    paddingTop: 52,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  closeButtonPressed: { backgroundColor: '#f0f0f0' },
  closeIcon: { fontSize: 28, lineHeight: 30, color: '#111', fontWeight: '300' },
  heading: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#111' },
  headerSpacer: { width: 36, height: 36 },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  headerIconButtonPressed: { backgroundColor: '#f0f0f0' },
  moreIcon: { fontSize: 22, lineHeight: 24, color: '#111', fontWeight: '700' },
  // 22×22 composite pencil icon: a thin diagonal rectangle (body) + a
  // small downward triangle (tip), wrapped in a -45°-rotated container
  // so the whole thing reads as a tilted pencil. Bigger and crisper
  // than the previous Unicode-glyph approach, monochrome by design.
  pencilIcon: {
    width: 22,
    height: 22,
    transform: [{ rotate: '-45deg' }],
  },
  pencilBody: {
    position: 'absolute',
    width: 5,
    height: 14,
    top: 2,
    left: 8.5, // (22 − 5) / 2 — centered horizontally in the icon box
    backgroundColor: '#111',
  },
  pencilTip: {
    position: 'absolute',
    top: 16,
    left: 8.5,
    width: 0,
    height: 0,
    borderLeftWidth: 2.5,
    borderLeftColor: 'transparent',
    borderRightWidth: 2.5,
    borderRightColor: 'transparent',
    // Top border becomes the visible triangle face; the transparent
    // L/R borders give it sloped sides that taper to a point at the
    // bottom — the classic CSS-triangle border trick.
    borderTopWidth: 4,
    borderTopColor: '#111',
  },
  body: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 16,
  },
  // View mode body uses bigger padding + spacing so the read-only details
  // breathe in the now-full-screen sheet (when SHEET_TOP_OFFSET was 60 the
  // 16-pad form felt full; in full-screen the same padding looks cramped).
  viewBody: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    gap: 28,
  },
  viewRow: { gap: 6 },
  viewLabel: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  viewValue: { fontSize: 17, color: '#111', lineHeight: 24 },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggle: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  toggleSelected: { backgroundColor: '#111', borderColor: '#111' },
  toggleLabel: { fontSize: 14, color: '#444' },
  toggleLabelSelected: { fontSize: 14, color: '#fff', fontWeight: '600' },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '500', color: '#444' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  notesInput: {
    minHeight: 96,
  },
  // Repeat-weekly row: label on the left, custom mini-switch on the right.
  // Padded vertically so the tap target is comfortable, with the same
  // border treatment as the input fields above so it reads as a sibling
  // form control rather than a separate UI element.
  repeatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
  },
  repeatRowPressed: { backgroundColor: '#f7f7f7' },
  repeatLabel: { fontSize: 16, color: '#111' },
  // Mini-switch geometry — a 36×22 pill with a 16×16 knob that slides
  // from the left edge to the right edge. We hand-roll it instead of
  // using RN's Switch so the off / on visuals match the rest of the
  // sheet's monochrome aesthetic (RN Switch defaults to platform colors,
  // most notably iOS green which would clash).
  repeatSwitch: {
    width: 36,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#d1d1d1',
    padding: 3,
    justifyContent: 'center',
  },
  repeatSwitchOn: { backgroundColor: '#111' },
  repeatSwitchKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  repeatSwitchKnobOn: {
    // Translate the knob to the right edge of the track.
    transform: [{ translateX: 14 }],
  },
  // Day-of-week multi-picker: 7 chips in a row, evenly spaced. Each
  // chip is a small circle with a 2-letter day label; selected chips
  // invert (black fill, white text) to match the kind-toggle style
  // higher up in the sheet.
  dayChipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  dayChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipSelected: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  dayChipLabel: { fontSize: 13, color: '#444' },
  dayChipLabelSelected: { fontSize: 13, color: '#fff', fontWeight: '600' },
  // Row holding the until-date label + DatePicker. Visually mirrors the
  // existing Starts/Ends rows higher in the form so the recurrence
  // section feels of-a-piece with the time pickers.
  untilRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pickerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    gap: 10,
  },
  save: {
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#111',
    alignItems: 'center',
  },
  savePressed: { opacity: 0.85 },
  saveDisabled: { opacity: 0.5 },
  saveLabel: { fontSize: 14, color: '#fff', fontWeight: '600' },
  // Full-sheet transparent area behind the popover — taps here close the
  // menu without dismissing the sheet (which is what `onClose` would do).
  menuScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  // Popover itself: anchored to the top-right of the sheet, just below the
  // header. Rough alignment with the three-dots button without doing a full
  // measure-on-layout pass.
  menuPopover: {
    position: 'absolute',
    top: 56,
    right: 12,
    minWidth: 160,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
  },
  menuItem: {
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  menuItemPressed: { backgroundColor: '#f4f4f4' },
  menuItemLabel: { fontSize: 15, color: '#111' },
  menuItemDanger: { color: '#d92d20' },
});

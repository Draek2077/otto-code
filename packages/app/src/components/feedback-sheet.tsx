import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { ScrollableCodeSurface } from "@/components/ui/scrollable-code-surface";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { TextAreaScrollFrame } from "@/components/ui/text-area";
import {
  buildFeedbackPayload,
  canSubmitFeedback,
  formatFeedbackContext,
  type FeedbackKind,
} from "@/feedback/feedback-payload";
import { submitFeedback } from "@/feedback/submit-feedback";
import { useCollectFeedbackFacts } from "@/feedback/use-feedback-context";
import { openLink } from "@/utils/open-link";
import { toErrorMessage } from "@/utils/error-messages";

interface FeedbackSheetProps {
  visible: boolean;
  onClose: () => void;
}

const KIND_OPTIONS: SegmentedControlOption<FeedbackKind>[] = [
  { value: "bug", label: "Bug", testID: "feedback-kind-bug" },
  { value: "idea", label: "Idea", testID: "feedback-kind-idea" },
  { value: "other", label: "Other", testID: "feedback-kind-other" },
];

const MESSAGE_PLACEHOLDERS: Record<FeedbackKind, string> = {
  bug: "What happened, and what did you expect instead?",
  idea: "What would you like Otto to do?",
  other: "What's on your mind?",
};

const ISSUES_URL = "https://github.com/Draek2077/otto-code/issues";

export function FeedbackSheet({ visible, onClose }: FeedbackSheetProps): ReactElement {
  const collectFacts = useCollectFeedbackFacts();

  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [fieldResetKey, setFieldResetKey] = useState(0);

  // Snapshot the facts once per open. Re-reading them on every render would let
  // a host reconnecting in the background rewrite the block mid-read, so what
  // the reporter approved and what gets sent could differ.
  const [facts, setFacts] = useState(() => collectFacts());
  const context = useMemo(() => formatFeedbackContext(facts), [facts]);

  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setKind("bug");
      setMessage("");
      setContact("");
      setIncludeContext(true);
      setIsSubmitting(false);
      setSubmitError(null);
      setSent(false);
      setFacts(collectFacts());
      setFieldResetKey((key) => key + 1);
    }
    wasVisibleRef.current = visible;
  }, [visible, collectFacts]);

  const canSubmit = canSubmitFeedback({ message, isSubmitting });

  const handleSubmit = useCallback(async () => {
    if (!canSubmitFeedback({ message, isSubmitting })) {
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await submitFeedback(
        buildFeedbackPayload({ kind, message, contact, context, facts, includeContext }),
      );
      setSent(true);
    } catch (error) {
      setSubmitError(toErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [kind, message, contact, context, facts, includeContext, isSubmitting]);

  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const handleOpenIssues = useCallback(() => {
    void openLink(ISSUES_URL);
  }, []);

  const header = useMemo<SheetHeader>(() => ({ title: "Send feedback" }), []);

  const footer = useMemo(() => {
    if (sent) {
      return (
        <View style={styles.footer}>
          <Button style={styles.footerButton} variant="default" onPress={onClose}>
            Done
          </Button>
        </View>
      );
    }
    return (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={onClose}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={handleSubmitPress}
          disabled={!canSubmit}
          loading={isSubmitting}
          testID="feedback-submit"
        >
          Send feedback
        </Button>
      </View>
    );
  }, [canSubmit, handleSubmitPress, isSubmitting, onClose, sent]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      footer={footer}
      webScrollbar
      testID="feedback-sheet"
    >
      {sent ? (
        <View style={styles.sentBlock} testID="feedback-sent">
          <Text style={styles.sentTitle}>Thanks — your feedback was sent.</Text>
          <Text style={styles.sentBody}>
            {contact.trim().length > 0
              ? "Every report gets read, and you may hear back at the contact you left."
              : "Every report gets read. You sent this anonymously, so there's no way to reply — reopen this sheet with a contact if you'd like an answer."}
          </Text>
        </View>
      ) : (
        <>
          <Field label="What kind of feedback?" testID="feedback-kind">
            <SegmentedControl
              options={KIND_OPTIONS}
              value={kind}
              onValueChange={setKind}
              stretch
              testID="feedback-kind-control"
            />
          </Field>

          <Field label="Message" testID="feedback-message">
            <TextAreaScrollFrame>
              <AdaptiveTextInput
                testID="feedback-message-input"
                accessibilityLabel="Feedback message"
                initialValue={message}
                resetKey={`feedback-message-${fieldResetKey}`}
                value={message}
                onChangeText={setMessage}
                placeholder={MESSAGE_PLACEHOLDERS[kind]}
                style={styles.multilineInput}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
            </TextAreaScrollFrame>
          </Field>

          <Field
            label="Contact (optional)"
            hint="Leave blank to stay anonymous."
            testID="feedback-contact"
          >
            <AdaptiveTextInput
              testID="feedback-contact-input"
              accessibilityLabel="Contact"
              initialValue={contact}
              resetKey={`feedback-contact-${fieldResetKey}`}
              value={contact}
              onChangeText={setContact}
              placeholder="email or handle"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>

          {/* Preview-before-send: the reporter reads the exact block that will
              travel with the report, and can switch it off entirely. */}
          <View style={styles.contextBlock}>
            <View style={styles.contextHeader}>
              <View style={styles.contextHeaderText}>
                <Text style={styles.contextTitle}>Attach app details</Text>
                <Text style={styles.contextHint}>
                  Helps with triage. No file paths, project names, or host addresses.
                </Text>
              </View>
              <Switch
                value={includeContext}
                onValueChange={setIncludeContext}
                accessibilityLabel="Attach app details"
                testID="feedback-include-context"
              />
            </View>
            {includeContext ? (
              <ScrollableCodeSurface maxHeight={160}>{context}</ScrollableCodeSurface>
            ) : null}
          </View>

          {submitError ? (
            <Text style={styles.error} testID="feedback-error">
              {submitError}
            </Text>
          ) : null}

          <Button variant="ghost" size="sm" onPress={handleOpenIssues}>
            Prefer GitHub? Open an issue
          </Button>
        </>
      )}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
  },
  multilineInput: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
    minHeight: 120,
  },
  contextBlock: {
    gap: theme.spacing[2],
  },
  contextHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  contextHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  contextTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  contextHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
  },
  sentBlock: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
  },
  sentTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  sentBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
}));

// Owns the conversation a reviewer has about the change in front of them,
// without leaving it.
//
// Chatting used to mean going to the thread, which meant losing sight of the
// change - the reviewer ended up describing from memory the thing they had
// just been looking at. So the conversation comes to the change instead: the
// drawer hangs off the bottom of the review bar, the diff stays where it was,
// and the reviewer types, reads the answer, and iterates until the change is
// what they want. Only then do they answer it.
//
// The drawer shows the thread rather than a copy of it. Every message here was
// sent to, or came from, the same thread the comment owns, which is why an
// answer arrives in both places without anything being mirrored: there is one
// conversation, drawn twice.

import { useEffect, useRef, useState } from "react";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { SEND_ICON } from "../../icons/lucide/send.js";
import { X_ICON } from "../../icons/lucide/x.js";
import { EXTERNAL_LINK_ICON } from "../../icons/lucide/external-link.js";
import { EYE_ICON } from "../../icons/lucide/eye.js";
import { CLOCK_ICON } from "../../icons/lucide/clock.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import { Icon } from "./icon.browser.js";
import { Button, Textarea, Tooltip, WorkingMark } from "./ui.browser.js";
import {
  isModifierEnter,
  MODIFIER_SHORTCUT_KEYS,
} from "./keyboard-shortcut.browser.js";
import {
  changeChatSpokenWords,
  type ChangeChatMessage,
} from "../shared/change-chat.js";

export type ChangeChatValue = {
  readonly messages: ReadonlyArray<ChangeChatMessage>;
  /**
   * How many of this thread's turns are about other changes.
   *
   * Narrowing hides messages, and a reviewer who cannot find one they know
   * they sent concludes it was lost. Saying how many are elsewhere, with a way
   * to go there, is what turns hidden into somewhere else.
   */
  readonly elsewhereCount?: number;
  /**
   * What the thread is called now.
   *
   * The bar captured its label when the tour opened, so a draft whose body the
   * drawer then rewrote kept announcing the sentence it no longer said. The
   * label travels with the conversation instead, because the conversation is
   * the thing that changes it.
   */
  readonly threadLabel?: string;
  /**
   * Answers a warning by telling the agent to go ahead.
   *
   * A warning is the agent asking for confirmation, so the drawer has to be
   * able to give it: reading the boundary with no way to say "do it" leaves
   * the reviewer to retype the permission the agent just asked for.
   */
  readonly onProceed?: () => void;
  /** True while a message this reviewer sent is still on its way. */
  readonly isSending: boolean;
  /** Why the reviewer may not send, when they may not. */
  readonly unavailable?: string;
  readonly onSend: (body: string) => void;
  /** Opens the full thread, for the rest of the conversation's context. */
  readonly onOpenThread: () => void;
  /**
   * Takes the reviewer to the first message this drawer is not showing, and
   * marks it on arrival.
   *
   * Offered only while there is one to go to, which is the same condition the
   * count is shown under: a link that lands nowhere is worse than no link, and
   * messages the reviewer can already see need no link at all - the drawer's
   * own scrollbar says they are there.
   */
  readonly onOpenElsewhere?: () => void;
};

const AUTHOR_LABEL: Readonly<Record<ChangeChatMessage["author"], string>> = {
  reviewer: "You",
  agent: "Agent",
};

export const ChangeChatDrawer = ({
  chat,
  subjectLabel,
  onShowChange,
  onClose,
}: {
  readonly chat: ChangeChatValue;
  /** What the conversation is about, so the drawer can say so once. */
  readonly subjectLabel: string;
  /**
   * Brings the change back into view.
   *
   * The drawer is tall, and a reviewer who scrolls while talking can leave the
   * change behind. Scrolling back by hand lands badly, because half the
   * viewport is now this bar: only the positioner that knows where the bar's
   * top edge is can put the change where it can be read.
   */
  readonly onShowChange: () => void;
  readonly onClose: () => void;
}) => {
  const [body, setBody] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const lastMessageId = chat.messages.at(-1)?.id;

  // The reviewer opened this to say something, so the cursor is already there.
  useEffect(() => {
    composer.current?.focus();
  }, []);

  // A new turn arrives while the reviewer is reading, so the log follows it.
  useEffect(() => {
    const element = log.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
  }, [lastMessageId, chat.isSending]);

  const send = (): void => {
    if (body.trim() === "" || chat.unavailable !== undefined) return;
    chat.onSend(body);
    setBody("");
  };

  return (
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] border-t border-edge bg-surface"
      data-review-change-chat=""
    >
      <div className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-2xs text-muted">
        <span className="inline-flex min-w-0 shrink items-center gap-1 font-semibold text-ink [&>svg]:size-3.5">
          <Icon icon={MESSAGE_SQUARE_ICON} />
          <span className="truncate">Chat about {subjectLabel}</span>
        </span>
        <span className="min-w-0 flex-1" />
        <Button
          variant="ghost"
          size="micro"
          aria-label="View the diff this chat is about"
          onClick={onShowChange}
        >
          <Icon icon={EYE_ICON} />
          View diff
        </Button>
        <Button
          variant="ghost"
          size="micro"
          aria-label="Open the full thread"
          onClick={chat.onOpenThread}
        >
          <Icon icon={EXTERNAL_LINK_ICON} />
          Open thread
        </Button>
        <Button
          variant="ghost"
          size="compactIcon"
          aria-label="Close chat"
          onClick={onClose}
        >
          <Icon icon={X_ICON} />
        </Button>
      </div>
      {/* Bounded, because the whole point is that the change stays in view: a
          log that grew with the conversation would push the diff off the top
          of the screen one answer at a time. */}
      <div
        ref={log}
        className="grid max-h-[min(32vh,15rem)] min-w-0 grid-cols-[minmax(0,1fr)] gap-2 overflow-y-auto px-3 pb-2"
        data-review-change-chat-log=""
      >
        {chat.messages.length === 0 ? (
          <p className="m-0 text-2xs text-muted">
            Say what you want this change to do instead. The agent answers here,
            and the change updates in place above.
          </p>
        ) : (
          chat.messages.map((message) => (
            <div
              key={message.id}
              data-review-change-chat-message={message.author}
              // The reviewer's turns sit to the right and the agent's to the
              // left, so the conversation reads as one at a glance rather than
              // as a list of labelled records.
              className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 ${
                message.author === "reviewer" ? "justify-items-end" : ""
              }`}
            >
              <span
                data-review-change-chat-bubble=""
                className={`grid min-w-0 max-w-[85%] grid-cols-[minmax(0,1fr)] gap-0.5 rounded-xl px-3 py-1.5 ${
                  message.author === "reviewer"
                    ? "rounded-br-sm bg-accent-soft text-ink"
                    : "rounded-bl-sm border border-edge bg-paper text-ink"
                }`}
              >
                <span className="text-2xs font-semibold text-subtle">
                  {AUTHOR_LABEL[message.author]}
                </span>
                <span className="min-w-0 whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">
                  {message.author === "reviewer"
                    ? changeChatSpokenWords(message.body)
                    : message.body}
                </span>
                {/* A warning is not an answer the reviewer can only read: the
                    agent stopped short and asked to be told to go ahead, so
                    the boundary it named and the way past it travel with the
                    message rather than living somewhere else. */}
                {message.warning === undefined ? null : (
                  <span
                    className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-1 rounded-md bg-[var(--callout-warning-bg)] px-2 py-1.5 text-[var(--callout-warning-ink)]"
                    data-review-change-chat-warning=""
                  >
                    <span className="inline-flex items-center gap-1 text-2xs font-semibold uppercase tracking-caps text-[var(--callout-warning-c)] [&>svg]:size-3.5">
                      <Icon icon={TRIANGLE_ALERT_ICON} />
                      Warning
                    </span>
                    <em className="text-2xs">{message.warning}</em>
                    {chat.onProceed === undefined ? null : (
                      <Tooltip
                        label="Tell the agent to go ahead"
                        shortcutKeys={MODIFIER_SHORTCUT_KEYS}
                        asChild
                      >
                        <Button
                          variant="accentOutline"
                          size="micro"
                          className="justify-self-start"
                          disabled={
                            chat.isSending || chat.unavailable !== undefined
                          }
                          onClick={chat.onProceed}
                        >
                          {chat.isSending ? "Sending…" : "Do it anyway"}
                        </Button>
                      </Tooltip>
                    )}
                  </span>
                )}
              </span>
              {/* Outside the bubble, because it is not something anyone said:
                  it is the state of the conversation, and putting it inside
                  made the reviewer's own message look like it contained it.
                  Queued and working are drawn apart, because a turning spinner
                  over a message nobody has picked up promises work that is not
                  happening yet. */}
              {message.awaiting === undefined ? null : (
                <span
                  className="inline-flex items-center gap-1 text-2xs text-muted"
                  data-review-change-chat-awaiting={message.awaiting}
                >
                  {message.awaiting === "working" ? (
                    <>
                      <WorkingMark />
                      The agent is working on this
                    </>
                  ) : (
                    <>
                      <Icon icon={CLOCK_ICON} />
                      Queued for the agent
                    </>
                  )}
                </span>
              )}
            </div>
          ))
        )}
      </div>
      {/* Shown only when it can do its one job. The count is of turns this
          drawer is not rendering, so a message the reviewer can already see is
          never counted here and never linked to - the scrollbar is what says
          those exist. When there is nothing to go to there is no link, rather
          than a link that scrolls the reader somewhere and leaves them to work
          out why. */}
      {chat.elsewhereCount === undefined ||
      chat.elsewhereCount === 0 ||
      chat.onOpenElsewhere === undefined ? null : (
        <p className="m-0 px-3 pb-2 text-2xs text-muted">
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-2xs text-muted underline underline-offset-[0.16em] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            data-review-change-chat-elsewhere=""
            onClick={chat.onOpenElsewhere}
          >
            {chat.elsewhereCount === 1
              ? "1 other message in this thread"
              : `${chat.elsewhereCount} other messages in this thread`}
          </button>
        </p>
      )}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 px-3 pb-2">
        <Textarea
          ref={composer}
          rows={2}
          value={body}
          aria-label="Message the agent about this change"
          placeholder="Say what you want instead…"
          disabled={chat.unavailable !== undefined}
          className="min-h-0 text-xs"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (!isModifierEnter(event)) return;
            event.preventDefault();
            send();
          }}
        />
        <Tooltip
          label="Send to the agent"
          shortcutKeys={MODIFIER_SHORTCUT_KEYS}
          asChild
        >
          <Button
            size="micro"
            disabled={body.trim() === "" || chat.unavailable !== undefined}
            aria-label={chat.unavailable ?? "Send this message to the agent"}
            onClick={send}
          >
            <Icon icon={SEND_ICON} />
            Send
          </Button>
        </Tooltip>
      </div>
      {chat.unavailable === undefined ? null : (
        <p className="m-0 px-3 pb-2 text-2xs text-muted">{chat.unavailable}</p>
      )}
    </div>
  );
};

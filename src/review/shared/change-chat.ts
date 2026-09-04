// Owns what the agent is told when a reviewer talks about one change rather
// than about a thread.
//
// A reply sent from a thread carries the thread, and that is enough while the
// conversation is about the comment. It stops being enough the moment the
// reviewer is standing in front of one change out of several, saying "not like
// this": the thread names the ask, not the place, and an agent reading only the
// thread has to guess which of the changes it published the reviewer means.
//
// So the place travels with the words. It travels in the message itself rather
// than beside it, because the agent reads the thread as prose and a field it
// never looks at would be a context nobody receives - and because a reviewer
// who later reads their own thread should see exactly what the agent saw.

/** The change a message is about, as the reviewer is looking at it. */
export type ChangeChatSubject = {
  /** The slide the change sits on, as the diff names it. */
  readonly section: string;
  /** What the change did there: reworded, replaced, added, removed. */
  readonly note: string;
  /** Which change of how many, so "this one" is unambiguous in a set. */
  readonly position?: { readonly index: number; readonly total: number };
};

/** How the subject reads in one line. */
export const changeChatSubjectLine = ({
  section,
  note,
  position,
}: ChangeChatSubject): string => {
  const where = section.trim() === "" ? "this change" : section.trim();
  const which =
    position === undefined || position.total <= 1
      ? ""
      : ` (${position.index} of ${position.total} in this change set)`;
  return `About the ${note} change on ${where}${which}:`;
};

/**
 * The message the thread receives.
 *
 * The addressing is a line the agent needs and the reviewer does not: they are
 * looking at the change, so saying which one back to them is noise in their
 * own bubble. It is sent all the same - the thread is what the agent reads -
 * and the surface that draws the conversation takes it back off.
 */
export const changeChatMessage = ({
  body,
  subject,
}: {
  readonly body: string;
  readonly subject: ChangeChatSubject;
}): string => {
  const words = body.trim();
  return words === "" ? "" : `${changeChatSubjectLine(subject)}\n\n${words}`;
};

/**
 * The words a reviewer actually typed, recovered from a message the drawer
 * addressed for them.
 *
 * The conversation is the thread, so the drawer reads back exactly what was
 * sent - addressing and all. Showing them the line they did not write, in the
 * bubble that is theirs, is what makes their own message read as machinery,
 * and they are looking at the change it names.
 */
export const changeChatSpokenWords = (body: string): string => {
  const [first, ...rest] = body.split("\n\n");
  return first !== undefined &&
    first.startsWith("About the ") &&
    first.endsWith(":") &&
    rest.length > 0
    ? rest.join("\n\n")
    : body;
};

/** One turn of the conversation, as a surface draws it. */
export type ChangeChatMessage = {
  readonly id: string;
  readonly author: "reviewer" | "agent";
  readonly body: string;
  /**
   * How the agent is holding this message, while it still owes an answer.
   *
   * Queued and working are different facts, and a spinner over a message no
   * agent has picked up promises work that is not happening: the reviewer
   * watches it turn and concludes their message is being written about, when
   * it is sitting in a mailbox.
   */
  readonly awaiting?: "queued" | "working";
  /**
   * The boundary the agent says this answer would cross, when it says one.
   *
   * A warning is not a refusal and not a change: it is the agent asking to be
   * told to go ahead, so the conversation has to carry it or the reviewer is
   * left reading an explanation with nothing to do about it.
   */
  readonly warning?: string;
};

/** One round of a thread, reduced to what a conversation needs from it. */
export type ChangeChatRound = {
  readonly requestId: string;
  /** What the reviewer said in this round, where they said anything. */
  readonly said?: string;
  /** What the agent answered about this comment, once it answered. */
  readonly answered?: string;
  /** How the agent is holding this round, while it still owes an answer. */
  readonly awaiting?: "queued" | "working";
  /** The change this round is about, where it is about one. */
  readonly aboutBlockId?: string;
  /** A boundary the agent says the answer would cross, when it says one. */
  readonly warning?: string;
};

/**
 * The thread as a conversation, narrowed to one change when one is named.
 *
 * The thread is general and the drawer is not: a reviewer standing in front of
 * one change is not talking about the others, and a drawer that showed every
 * round would bury what they said about this one under chatter about the rest.
 * So a round is shown only when it is about the change being reviewed, and the
 * comment - which opened the thread rather than any one change - opens the
 * conversation only when no change is named.
 *
 * Rounds that carry neither a message nor an answer contribute nothing: a
 * round can exist for reasons the reviewer never spoke into, and an empty
 * bubble reads as a lost message.
 */
export const changeChatTurns = ({
  comment,
  rounds,
  about,
}: {
  /** The comment that opened the thread, and the change it was about. */
  readonly comment: {
    readonly body: string;
    readonly aboutBlockId?: string;
  };
  readonly rounds: ReadonlyArray<ChangeChatRound>;
  /** The change the conversation is about, where it is about one. */
  readonly about?: string;
}): ReadonlyArray<ChangeChatMessage> => {
  const turns: Array<ChangeChatMessage> = [];
  const shown =
    about === undefined
      ? rounds
      : rounds.filter((round) => round.aboutBlockId === about);
  // The comment is the first thing said in its thread, and it carries its own
  // association: one written from the drawer is about that change, one written
  // as a note on the plan is about the thread. So it joins a narrowed
  // conversation on exactly the test every later round passes, which is what
  // stops the one message a reviewer sent from the drawer being the one
  // message the drawer cannot show them.
  const opener = comment.body.trim();
  if (
    opener !== "" &&
    (about === undefined || comment.aboutBlockId === about)
  ) {
    turns.push({ id: "comment", author: "reviewer", body: opener });
  }
  for (const round of shown) {
    const said = round.said?.trim() ?? "";
    if (said !== "") {
      turns.push({
        id: `${round.requestId}:said`,
        author: "reviewer",
        body: said,
        ...(round.awaiting === undefined ? {} : { awaiting: round.awaiting }),
      });
    }
    const answered = round.answered?.trim() ?? "";
    if (answered !== "") {
      turns.push({
        id: `${round.requestId}:answered`,
        author: "agent",
        body: answered,
        ...(round.warning === undefined ? {} : { warning: round.warning }),
      });
    }
  }
  // The opener is the only turn that can be left waiting when no reply has
  // been sent yet, and it is waiting exactly as the first round is.
  const first = shown.at(0);
  if (
    turns.length === 1 &&
    first?.awaiting !== undefined &&
    (first.said ?? "").trim() === ""
  ) {
    const [only] = turns;
    return only === undefined ? turns : [{ ...only, awaiting: first.awaiting }];
  }
  return turns;
};

/**
 * How many of this thread's turns a narrowed conversation is not showing.
 *
 * Narrowing hides messages, and a reviewer who cannot see a message they know
 * they sent concludes it was lost. Counting what is elsewhere is what turns
 * hidden into merely somewhere else.
 */
export const otherChangeChatTurns = ({
  comment,
  rounds,
  about,
}: {
  readonly comment: { readonly body: string; readonly aboutBlockId?: string };
  readonly rounds: ReadonlyArray<ChangeChatRound>;
  readonly about?: string;
}): number =>
  about === undefined
    ? 0
    : changeChatTurns({ comment, rounds }).length -
      changeChatTurns({ comment, rounds, about }).length;

/**
 * The turn a narrowed conversation is not showing, that the reviewer should be
 * taken to when they ask where the rest of the thread went.
 *
 * The first one, because it is where the part of the conversation they cannot
 * see begins; reading forward from there is how a thread is read. It answers
 * with the request that carries the turn, because that is what the thread
 * renders and therefore what can be scrolled to and flashed - the opener has
 * no request of its own, so it answers with `"comment"`, which the thread
 * shows first.
 */
export const firstOtherChangeChatTurn = ({
  comment,
  rounds,
  about,
}: {
  readonly comment: { readonly body: string; readonly aboutBlockId?: string };
  readonly rounds: ReadonlyArray<ChangeChatRound>;
  readonly about?: string;
}): string | undefined => {
  if (about === undefined) return undefined;
  const shown = new Set(
    changeChatTurns({ comment, rounds, about }).map((turn) => turn.id),
  );
  const hidden = changeChatTurns({ comment, rounds }).find(
    (turn) => !shown.has(turn.id),
  );
  if (hidden === undefined) return undefined;
  return hidden.id === "comment"
    ? "comment"
    : (hidden.id.split(":").at(0) ?? "comment");
};

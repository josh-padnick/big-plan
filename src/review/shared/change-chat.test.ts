// Proves a message sent from the change drawer tells the agent which change it
// is about, without touching the reviewer's own words.

import { describe, expect, it } from "vitest";
import {
  changeChatMessage,
  changeChatSpokenWords,
  changeChatSubjectLine,
  changeChatTurns,
  firstOtherChangeChatTurn,
  otherChangeChatTurns,
} from "./change-chat.js";

const subject = {
  section: "3 / Rollback",
  note: "reworded",
} as const;

describe("changeChatSubjectLine", () => {
  it("names the slide and what the change did there", () => {
    expect(changeChatSubjectLine(subject)).toBe(
      "About the reworded change on 3 / Rollback:",
    );
  });

  it("says which change of how many when the set holds several", () => {
    expect(
      changeChatSubjectLine({
        ...subject,
        position: { index: 2, total: 3 },
      }),
    ).toBe(
      "About the reworded change on 3 / Rollback (2 of 3 in this change set):",
    );
  });

  it("leaves the position out of a set with one change in it", () => {
    expect(
      changeChatSubjectLine({
        ...subject,
        position: { index: 1, total: 1 },
      }),
    ).toBe("About the reworded change on 3 / Rollback:");
  });

  it("falls back to naming the change when the diff has no section", () => {
    expect(changeChatSubjectLine({ section: "  ", note: "added" })).toBe(
      "About the added change on this change:",
    );
  });
});

describe("changeChatMessage", () => {
  it("puts the addressing above the reviewer's words, untouched", () => {
    expect(
      changeChatMessage({
        body: "  Say what the operator sees, not what the queue does.  ",
        subject,
      }),
    ).toBe(
      "About the reworded change on 3 / Rollback:\n\nSay what the operator sees, not what the queue does.",
    );
  });

  it("sends nothing for a message with nothing in it", () => {
    expect(changeChatMessage({ body: "   ", subject })).toBe("");
  });
});

describe("changeChatTurns", () => {
  it("opens with the comment, because that is the first thing said", () => {
    expect(
      changeChatTurns({
        comment: { body: "Name the recovery path." },
        rounds: [],
      }),
    ).toEqual([
      { id: "comment", author: "reviewer", body: "Name the recovery path." },
    ]);
  });

  it("alternates what the reviewer said with what the agent answered", () => {
    expect(
      changeChatTurns({
        comment: { body: "Name the recovery path." },
        rounds: [
          { requestId: "r1", answered: "Named it on Rollback." },
          { requestId: "r2", said: "Say it in the operator's words." },
        ],
      }),
    ).toEqual([
      { id: "comment", author: "reviewer", body: "Name the recovery path." },
      { id: "r1:answered", author: "agent", body: "Named it on Rollback." },
      {
        id: "r2:said",
        author: "reviewer",
        body: "Say it in the operator's words.",
      },
    ]);
  });

  it("marks the message the agent still owes an answer to", () => {
    const turns = changeChatTurns({
      comment: { body: "Name the recovery path." },
      rounds: [{ requestId: "r1", said: "Try again.", awaiting: "queued" }],
    });
    expect(turns.at(-1)).toEqual({
      id: "r1:said",
      author: "reviewer",
      body: "Try again.",
      awaiting: "queued",
    });
  });

  it("marks the comment itself when nothing has answered it yet", () => {
    expect(
      changeChatTurns({
        comment: { body: "Name the recovery path." },
        rounds: [{ requestId: "r1", awaiting: "queued" }],
      }),
    ).toEqual([
      {
        id: "comment",
        author: "reviewer",
        body: "Name the recovery path.",
        awaiting: "queued",
      },
    ]);
  });

  it("draws no bubble for a round nobody spoke into", () => {
    expect(
      changeChatTurns({
        comment: { body: "Ask." },
        rounds: [{ requestId: "r1", said: "  ", answered: "" }],
      }),
    ).toEqual([{ id: "comment", author: "reviewer", body: "Ask." }]);
  });
});

describe("changeChatSpokenWords", () => {
  it("gives back the words the reviewer typed, without the addressing", () => {
    expect(
      changeChatSpokenWords(
        changeChatMessage({ body: "Shorter, please.", subject }),
      ),
    ).toBe("Shorter, please.");
  });

  it("leaves an ordinary message alone", () => {
    expect(changeChatSpokenWords("Just a reply.")).toBe("Just a reply.");
  });

  it("keeps every paragraph the reviewer wrote", () => {
    expect(
      changeChatSpokenWords(
        changeChatMessage({ body: "One.\n\nTwo.", subject }),
      ),
    ).toBe("One.\n\nTwo.");
  });

  it("leaves a message that merely starts like the addressing", () => {
    // No blank line after it, so it is a sentence rather than a preamble.
    expect(changeChatSpokenWords("About the change on Delivery:")).toBe(
      "About the change on Delivery:",
    );
  });
});

describe("changeChatTurns narrowed to one change", () => {
  const rounds = [
    { requestId: "r1", said: "About the whole thread.", answered: "Noted." },
    {
      requestId: "r2",
      said: "Shorter here.",
      answered: "Shortened it.",
      aboutBlockId: "section/rollback/paragraph-1",
    },
    {
      requestId: "r3",
      said: "And here.",
      aboutBlockId: "section/delivery/paragraph-1",
      awaiting: "queued",
    },
  ] as const;

  it("shows the whole thread when no change is named", () => {
    expect(
      changeChatTurns({ comment: { body: "The ask." }, rounds }).map(
        (turn) => turn.body,
      ),
    ).toEqual([
      "The ask.",
      "About the whole thread.",
      "Noted.",
      "Shorter here.",
      "Shortened it.",
      "And here.",
    ]);
  });

  it("shows only what was said about the change being reviewed", () => {
    expect(
      changeChatTurns({
        comment: { body: "The ask." },
        rounds,
        about: "section/rollback/paragraph-1",
      }).map((turn) => turn.body),
    ).toEqual(["Shorter here.", "Shortened it."]);
  });

  it("leaves the thread's opening comment out of one change's conversation", () => {
    // The comment opened the thread, not this change, so it is chatter here.
    expect(
      changeChatTurns({
        comment: { body: "The ask." },
        rounds,
        about: "section/delivery/paragraph-1",
      }).map((turn) => turn.id),
    ).toEqual(["r3:said"]);
  });

  it("waits on the change's own round rather than the thread's first", () => {
    const [turn] = changeChatTurns({
      comment: { body: "The ask." },
      rounds,
      about: "section/delivery/paragraph-1",
    });
    expect(turn?.awaiting).toBe("queued");
  });

  it("carries the boundary the agent named onto its answer", () => {
    const turns = changeChatTurns({
      comment: { body: "The ask." },
      rounds: [
        {
          requestId: "r1",
          said: "In Spanish too.",
          answered: "That would mix languages.",
          warning: "Would mix languages in one plan",
          aboutBlockId: "section/rollback/paragraph-1",
        },
      ],
      about: "section/rollback/paragraph-1",
    });
    expect(turns.at(-1)).toMatchObject({
      author: "agent",
      warning: "Would mix languages in one plan",
    });
  });
});

describe("what the drawer says it is waiting on", () => {
  it("says queued while no agent has started the round", () => {
    const turns = changeChatTurns({
      comment: { body: "The ask." },
      rounds: [{ requestId: "r1", said: "Do this.", awaiting: "queued" }],
    });
    expect(turns.at(-1)?.awaiting).toBe("queued");
  });

  it("says working once one has", () => {
    // A spinner over a message nobody picked up promises work that is not
    // happening, so the two are told apart rather than merged into "waiting".
    const turns = changeChatTurns({
      comment: { body: "The ask." },
      rounds: [{ requestId: "r1", said: "Do this.", awaiting: "working" }],
    });
    expect(turns.at(-1)?.awaiting).toBe("working");
  });

  it("says nothing once the round is answered", () => {
    const turns = changeChatTurns({
      comment: { body: "The ask." },
      rounds: [{ requestId: "r1", said: "Do this.", answered: "Done." }],
    });
    expect(turns.map((turn) => turn.awaiting)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("otherChangeChatTurns", () => {
  const comment = { body: "The ask." };
  const rounds = [
    { requestId: "r1", said: "Elsewhere.", answered: "Fine." },
    {
      requestId: "r2",
      said: "Here.",
      aboutBlockId: "section/rollback/paragraph-1",
    },
  ] as const;

  it("counts nothing when the conversation is not narrowed", () => {
    expect(otherChangeChatTurns({ comment, rounds })).toBe(0);
  });

  it("counts the turns the narrowing left out", () => {
    // The ask and the two turns about elsewhere: three, so a reviewer is told
    // where the rest of the conversation went rather than left to assume it
    // was lost.
    expect(
      otherChangeChatTurns({
        comment,
        rounds,
        about: "section/rollback/paragraph-1",
      }),
    ).toBe(3);
  });

  it("counts nothing when the narrowing hides nothing", () => {
    expect(
      otherChangeChatTurns({
        comment: { body: "The ask.", aboutBlockId: "b" },
        rounds: [{ requestId: "r1", said: "Here.", aboutBlockId: "b" }],
        about: "b",
      }),
    ).toBe(0);
  });
});

// The drawer-scout's case 1 and case 2, at the layer that decides them: a
// conversation born from a draft, whose first message travels as the comment
// of a feedback package rather than as a reply.
describe("a draft-born conversation under a narrowed drawer", () => {
  const about = "section/delivery/paragraph-1";
  const comment = {
    body: "About the reworded change on Delivery:\n\nAdd a third paragraph.",
    aboutBlockId: about,
  };

  it("shows the first message while the agent still owes an answer", () => {
    expect(
      changeChatTurns({
        comment,
        rounds: [{ requestId: "r1", aboutBlockId: about, awaiting: "working" }],
        about,
      }),
    ).toEqual([
      {
        id: "comment",
        author: "reviewer",
        body: comment.body,
        // The message the agent owes an answer to is the comment itself, so
        // the waiting state belongs on it.
        awaiting: "working",
      },
    ]);
  });

  it("shows the answer to it in the same conversation", () => {
    expect(
      changeChatTurns({
        comment,
        rounds: [
          { requestId: "r1", aboutBlockId: about, answered: "Added it." },
        ],
        about,
      }).map((turn) => [turn.author, turn.body]),
    ).toEqual([
      ["reviewer", comment.body],
      ["agent", "Added it."],
    ]);
  });

  it("keeps a comment written as a plain note out of one change's drawer", () => {
    // A comment nobody wrote from the drawer is about the thread, so it stays
    // in the thread rather than joining a conversation it never began.
    expect(
      changeChatTurns({
        comment: { body: "A note on the plan." },
        rounds: [{ requestId: "r1", aboutBlockId: about, said: "Here." }],
        about,
      }).map((turn) => turn.body),
    ).toEqual(["Here."]);
  });
});

describe("firstOtherChangeChatTurn", () => {
  const rounds = [
    { requestId: "r1", said: "About delivery", aboutBlockId: "delivery/p1" },
    { requestId: "r2", said: "About rollback", aboutBlockId: "rollback/p1" },
    { requestId: "r3", answered: "Rollback done", aboutBlockId: "rollback/p1" },
  ];

  it("should name the request carrying the first message the drawer hides", () => {
    expect(
      firstOtherChangeChatTurn({
        comment: { body: "Opened about delivery", aboutBlockId: "delivery/p1" },
        rounds,
        about: "delivery/p1",
      }),
    ).toBe("r2");
  });

  it("should name the opener when that is what the drawer hides", () => {
    // The reviewer wrote the comment as a note on the plan, so a drawer
    // narrowed to one change does not show it - and it is the first thing the
    // thread says, so it is where the rest of the conversation begins.
    expect(
      firstOtherChangeChatTurn({
        comment: { body: "A note about the whole plan" },
        rounds: [
          {
            requestId: "r1",
            said: "About delivery",
            aboutBlockId: "delivery/p1",
          },
        ],
        about: "delivery/p1",
      }),
    ).toBe("comment");
  });

  it("should answer with nothing when the drawer is showing everything", () => {
    // Nothing to go to means no link at all, rather than a link that scrolls
    // the reviewer somewhere and leaves them to work out why.
    expect(
      firstOtherChangeChatTurn({
        comment: { body: "Opened about delivery", aboutBlockId: "delivery/p1" },
        rounds: [
          {
            requestId: "r1",
            said: "About delivery",
            aboutBlockId: "delivery/p1",
          },
        ],
        about: "delivery/p1",
      }),
    ).toBeUndefined();
  });

  it("should answer with nothing when the conversation is not narrowed", () => {
    expect(
      firstOtherChangeChatTurn({
        comment: { body: "Opened about delivery" },
        rounds,
      }),
    ).toBeUndefined();
  });
});

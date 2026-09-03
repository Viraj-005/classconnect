"""Quiz marking. Pure rules, no database and no framework.

Separated from the router for the usual reason in this codebase: the
part that decides whether an answer is right, and what a run is worth,
is the part worth testing on its own.

Three rules shape everything here.

A question the student has not answered is wrong, not skipped. Scoring
out of "questions attempted" would let somebody answer the one question
they knew and score a hundred percent, which is not what a pass rate is
supposed to mean.

Written answers are never marked automatically. Free text compared by
string match gives a zero to a correct answer phrased differently, and
that is worse than not marking it at all. A person marks them, and until
they do the attempt has no final score.

Any mark can be overridden by a teacher, including one the server
awarded. An accepted alternative answer, a question that turned out to
be ambiguous, or a straightforward mistake all need a way out that is
not "tell the student the computer said no".
"""

from dataclasses import dataclass, field

# Where the bands sit. Sixty is the pass mark used across the product,
# and the borderline band exists so a teacher can see who nearly made it
# rather than only a pass or fail count.
PASS_MARK = 60
BORDERLINE_MARK = 40

CHOICE = "choice"
MULTI = "multi"
WRITTEN = "written"


@dataclass(frozen=True)
class Question:
    """A question, as the marker needs it. Never sent to a student."""

    question_id: str
    points: int = 1
    kind: str = CHOICE
    correct_index: int = 0
    # For a multi answer question: every option that counts as correct.
    correct_indexes: tuple[int, ...] = ()

    @property
    def is_written(self) -> bool:
        return self.kind == WRITTEN

    @property
    def is_multi(self) -> bool:
        return self.kind == MULTI

    @property
    def answer_set(self) -> frozenset:
        """The correct options, whichever kind this is.

        A single answer question is the one element case of a multi
        answer one, which lets the marker treat them the same and keeps
        the two from drifting apart.
        """
        if self.is_multi:
            return frozenset(self.correct_indexes)
        return frozenset({self.correct_index})


@dataclass(frozen=True)
class Marked:
    score: int
    max_score: int
    correct_ids: tuple[str, ...] = ()
    wrong_ids: tuple[str, ...] = ()
    unanswered_ids: tuple[str, ...] = ()
    # Written questions with an answer and no mark yet.
    pending_ids: tuple[str, ...] = ()
    # Marks a teacher set by hand, overriding whatever the server said.
    overridden_ids: tuple[str, ...] = ()
    per_question: dict = field(default_factory=dict)

    @property
    def awaiting_marking(self) -> bool:
        return bool(self.pending_ids)

    @property
    def percent(self) -> int:
        """Provisional while anything is still pending."""
        return round(self.score / self.max_score * 100) if self.max_score else 0

    @property
    def band(self) -> str:
        return band_of(self.percent)

    @property
    def passed(self) -> bool:
        return self.percent >= PASS_MARK


def _clean_indexes(given) -> frozenset | None:
    """A submitted answer as a set of option indexes, or None if unusable.

    Answers arrive over the wire from a browser, so anything can turn
    up. bool is rejected explicitly because it is an int in Python and
    True would otherwise match option 1.
    """
    if given is None:
        return None
    values = given if isinstance(given, (list, tuple, set, frozenset)) else [given]
    out = set()
    for v in values:
        if not isinstance(v, int) or isinstance(v, bool):
            return None
        out.add(v)
    return frozenset(out)


def _auto_mark(question: Question, given) -> int | None:
    """Marks the server can award on its own, or None if it cannot.

    None is the honest answer for a written question. Returning zero
    instead would be indistinguishable from a wrong answer, and an
    attempt sitting in the marking queue would look like a fail while it
    waited.

    Multi answer questions are all or nothing: every correct option and
    no incorrect one. Part marks for a partly right answer sound kinder
    and are not, because "which of these three are true" has no
    defensible way to score two out of three against a student who
    guessed all of them. A teacher can still award part marks by hand,
    which is the right place for that judgement.
    """
    if question.is_written:
        return None
    chosen = _clean_indexes(given)
    if chosen is None or not chosen:
        return 0
    return question.points if chosen == question.answer_set else 0


def mark(
    questions: list[Question],
    answers: dict,
    awarded: dict | None = None,
) -> Marked:
    """Mark a submission.

    `answers` maps question id to what the student gave: an option index
    for a choice question, a string for a written one.

    `awarded` maps question id to marks a teacher has set by hand. It
    wins over anything the server worked out, which is what makes both
    the written marking queue and a manual override the same mechanism
    rather than two.
    """
    awarded = awarded or {}
    correct: list[str] = []
    wrong: list[str] = []
    unanswered: list[str] = []
    pending: list[str] = []
    overridden: list[str] = []
    per_question: dict = {}
    score = 0
    max_score = 0

    for q in questions:
        max_score += q.points
        given = answers.get(q.question_id)
        blank = (
            given is None
            or (isinstance(given, str) and not given.strip())
            or (isinstance(given, (list, tuple, set)) and len(given) == 0)
        )

        manual = awarded.get(q.question_id)
        if manual is not None:
            try:
                marks = int(manual)
            except (TypeError, ValueError):
                marks = 0
            # Clamped, so a slip in the marking screen cannot award five
            # marks on a two mark question and push a total over 100%.
            marks = max(0, min(q.points, marks))
            overridden.append(q.question_id)
        else:
            marks = _auto_mark(q, given)
            if marks is None:
                # Written, unmarked. Contributes nothing yet, and the
                # attempt is not finished.
                if blank:
                    unanswered.append(q.question_id)
                    marks = 0
                else:
                    pending.append(q.question_id)
                    per_question[q.question_id] = None
                    continue

        score += marks
        per_question[q.question_id] = marks

        if blank:
            unanswered.append(q.question_id)
        elif marks >= q.points:
            correct.append(q.question_id)
        elif marks > 0:
            # Part marks on a written answer. Neither right nor wrong.
            pass
        else:
            wrong.append(q.question_id)

    return Marked(
        score=score,
        max_score=max_score,
        correct_ids=tuple(correct),
        wrong_ids=tuple(wrong),
        unanswered_ids=tuple(unanswered),
        pending_ids=tuple(pending),
        overridden_ids=tuple(overridden),
        per_question=per_question,
    )


def band_of(percent: float) -> str:
    """The band for an already computed percentage.

    Used by the analytics rollup, which works from stored scores rather
    than from re-marking every attempt. Kept here so the thresholds live
    in exactly one place.
    """
    if percent >= PASS_MARK:
        return "passed"
    if percent >= BORDERLINE_MARK:
        return "borderline"
    return "failed"


def strip_answers(question: dict) -> dict:
    """A question as the student may see it.

    The correct index and the model answer must never reach the browser.
    Sending the whole row and hiding them in the UI would put the answer
    key in the network tab of any quiz, which is the sort of thing a
    fifteen year old finds in about a minute.
    """
    return {
        "questionId": question["questionId"],
        "position": question["position"],
        "prompt": question["prompt"],
        "kind": question.get("kind", CHOICE),
        "options": question["options"],
        "points": question["points"],
        # How many are correct, without saying which. A multi answer
        # question is unanswerable if the student cannot tell it takes
        # more than one, and the count alone gives nothing away: knowing
        # two of five are right still leaves ten combinations.
        "correctCount": len(question.get("correctIndexes") or [])
        if question.get("kind") == MULTI
        else 1,
    }

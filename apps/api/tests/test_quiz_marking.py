"""Quiz marking rules.

The scoring is the part a student has an incentive to get wrong in their
favour, and the part a teacher has to be able to defend when a parent
asks. Both make it worth testing on its own, away from a request.

Run with: pytest apps/api/tests -v
"""

import pytest

from app.services.quiz_service import (
    BORDERLINE_MARK,
    PASS_MARK,
    Question,
    band_of,
    mark,
    strip_answers,
)

Q = [
    Question(question_id="q1", correct_index=0, points=1),
    Question(question_id="q2", correct_index=2, points=1),
    Question(question_id="q3", correct_index=1, points=2),
]


def test_all_correct_scores_full_marks():
    m = mark(Q, {"q1": 0, "q2": 2, "q3": 1})
    assert (m.score, m.max_score) == (4, 4)
    assert m.percent == 100
    assert m.passed
    assert m.wrong_ids == () and m.unanswered_ids == ()


def test_points_are_weighted_not_counted():
    """A two point question is worth two points.

    Scoring by question count would make the hard question worth the
    same as the easy one, which is not what the teacher set up.
    """
    only_hard = mark(Q, {"q3": 1})
    only_easy = mark(Q, {"q1": 0, "q2": 2})
    assert only_hard.score == 2
    assert only_easy.score == 2


def test_an_unanswered_question_is_wrong_not_skipped():
    """Otherwise answering one question you know scores 100 percent.

    This is the rule the whole pass rate rests on. Marking out of
    questions attempted would let a student game every quiz by leaving
    everything they were unsure about blank.
    """
    m = mark(Q, {"q1": 0})
    assert m.max_score == 4, "the denominator must be the whole quiz"
    assert m.score == 1
    assert m.percent == 25
    assert m.unanswered_ids == ("q2", "q3")


def test_an_empty_submission_scores_zero_out_of_the_full_quiz():
    m = mark(Q, {})
    assert (m.score, m.max_score, m.percent) == (0, 4, 0)
    assert len(m.unanswered_ids) == 3


@pytest.mark.parametrize(
    "given", [99, -1, "0", None, 1.5, True, [0], {"a": 1}]
)
def test_a_malformed_answer_is_wrong_rather_than_a_crash(given):
    """Answers arrive over the wire from a browser.

    A submission with a string, a float or an out of range index is a
    bad answer, not a server error, so this must never raise. `True` is
    in the list because it is an int in Python and would otherwise
    silently match option 1.
    """
    m = mark([Question("q1", correct_index=1, points=1)], {"q1": given})
    assert m.score == 0
    assert m.percent == 0


def test_true_does_not_pass_as_option_one():
    """Explicitly, because bool is a subclass of int in Python."""
    m = mark([Question("q1", correct_index=1, points=1)], {"q1": True})
    assert m.score == 0
    assert m.wrong_ids == ("q1",)


def test_answers_for_questions_not_on_the_quiz_are_ignored():
    """A submission naming an unknown question changes nothing.

    Not an error either: a stale tab submitting against an edited quiz
    is a normal thing to happen, and it should mark what it can.
    """
    m = mark(Q, {"q1": 0, "q999": 3})
    assert m.score == 1
    assert "q999" not in m.correct_ids + m.wrong_ids + m.unanswered_ids


def test_a_quiz_with_no_questions_does_not_divide_by_zero():
    m = mark([], {})
    assert (m.score, m.max_score, m.percent) == (0, 0, 0)
    assert m.band == "failed"


# ----------------------------------------------------------------------
# Bands
# ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "pct,expected",
    [
        (100, "passed"),
        (PASS_MARK, "passed"),
        (PASS_MARK - 1, "borderline"),
        (BORDERLINE_MARK, "borderline"),
        (BORDERLINE_MARK - 1, "failed"),
        (0, "failed"),
    ],
)
def test_band_boundaries_are_inclusive_at_the_bottom(pct, expected):
    """Exactly the pass mark is a pass.

    Off by one here is the difference between a student passing and
    failing, and it is the sort of thing nobody notices until somebody
    scores exactly sixty.
    """
    assert band_of(pct) == expected


def test_mark_and_band_of_agree():
    """Two ways of reaching a band must not disagree.

    mark() bands a fresh submission, band_of() bands a stored score for
    the analytics rollup. If they ever drift, the teacher's dashboard
    and the student's result screen will say different things about the
    same attempt.
    """
    for score, total in [(0, 4), (1, 4), (2, 4), (3, 4), (4, 4), (6, 10), (5, 10)]:
        m = mark(
            [Question(f"q{i}", correct_index=0, points=1) for i in range(total)],
            {f"q{i}": 0 for i in range(score)},
        )
        assert m.band == band_of(m.percent)


# ----------------------------------------------------------------------
# The answer key must not leak
# ----------------------------------------------------------------------


def test_a_question_sent_to_a_student_carries_no_answer():
    """The correct index must never reach the browser.

    Sending the whole row and hiding it in the UI would put the answer
    key in the network tab of every quiz.
    """
    full = {
        "questionId": "q1",
        "position": 0,
        "prompt": "Which is a noble gas?",
        "options": ["Neon", "Oxygen", "Iron"],
        "points": 1,
        "correctIndex": 0,
        "correct_index": 0,
    }
    safe = strip_answers(full)
    assert "correctIndex" not in safe
    assert "correct_index" not in safe
    assert "0" not in str(safe.get("answer", ""))
    assert safe["options"] == ["Neon", "Oxygen", "Iron"]
    assert safe["prompt"] == full["prompt"]


# ----------------------------------------------------------------------
# Written answers, and marks a person sets by hand
# ----------------------------------------------------------------------

from app.services.quiz_service import CHOICE, WRITTEN  # noqa: E402

MIXED = [
    Question(question_id="c1", correct_index=0, points=1, kind=CHOICE),
    Question(question_id="w1", points=4, kind=WRITTEN),
]


def test_a_written_answer_is_never_marked_automatically():
    """Free text compared by string match is worse than not marking.

    A correct answer phrased differently would get a zero, and the
    student has no way to argue with it. The server declines and the
    attempt waits for a person.
    """
    m = mark(MIXED, {"c1": 0, "w1": "Because entropy always increases."})
    assert m.pending_ids == ("w1",)
    assert m.awaiting_marking
    # The choice half is marked already; only the written part waits.
    assert m.score == 1
    assert m.max_score == 5


def test_a_blank_written_answer_needs_no_marking():
    """Nothing to read means nothing to wait for.

    Otherwise every unanswered written question would park an attempt in
    the marking queue forever.
    """
    for blank in ("", "   ", None):
        m = mark(MIXED, {"c1": 0, "w1": blank})
        assert not m.awaiting_marking, blank
        assert "w1" in m.unanswered_ids


def test_marking_a_written_answer_completes_the_attempt():
    m = mark(MIXED, {"c1": 0, "w1": "A good answer"}, awarded={"w1": 3})
    assert not m.awaiting_marking
    assert m.score == 4          # 1 for the choice, 3 awarded
    assert m.percent == 80
    assert m.passed


def test_a_teacher_can_override_a_mark_the_server_awarded():
    """The point the user asked for: marks are editable by hand.

    An accepted alternative answer, an ambiguous question, or a plain
    mistake all need a way out that is not "the computer said no".
    """
    wrong = mark(MIXED, {"c1": 1, "w1": "x"}, awarded={"w1": 4})
    assert wrong.score == 4      # the choice scored nothing

    fixed = mark(MIXED, {"c1": 1, "w1": "x"}, awarded={"c1": 1, "w1": 4})
    assert fixed.score == 5
    assert fixed.percent == 100
    assert set(fixed.overridden_ids) == {"c1", "w1"}


def test_an_override_can_take_marks_away_as_well():
    m = mark(MIXED, {"c1": 0, "w1": "x"}, awarded={"c1": 0, "w1": 0})
    assert m.score == 0
    assert "c1" in m.overridden_ids


def test_awarded_marks_are_clamped_to_what_the_question_is_worth():
    """A slip in the marking screen must not push a total over 100.

    Ten out of four on one question would quietly produce a percentage
    above a hundred everywhere it was aggregated.
    """
    over = mark(MIXED, {"c1": 0, "w1": "x"}, awarded={"w1": 99})
    assert over.score == 5
    assert over.percent == 100

    under = mark(MIXED, {"c1": 0, "w1": "x"}, awarded={"w1": -5})
    assert under.score == 1


@pytest.mark.parametrize("rubbish", ["three", None, [], {}, "4.5"])
def test_a_malformed_award_does_not_crash_the_marker(rubbish):
    m = mark(MIXED, {"c1": 0, "w1": "x"}, awarded={"w1": rubbish})
    assert isinstance(m.score, int)
    assert 0 <= m.score <= m.max_score


def test_part_marks_are_neither_right_nor_wrong():
    """Two out of four is not a wrong answer.

    Counting it as one would make the per question breakdown on the
    teacher's screen say everybody failed a question most of the class
    half answered.
    """
    m = mark(MIXED, {"c1": 0, "w1": "half right"}, awarded={"w1": 2})
    assert "w1" not in m.wrong_ids
    assert "w1" not in m.correct_ids
    assert m.per_question["w1"] == 2


def test_a_quiz_of_only_choice_questions_never_waits_for_marking():
    """The common case must not be slowed down by the new one."""
    m = mark(Q, {"q1": 0, "q2": 2, "q3": 1})
    assert not m.awaiting_marking
    assert m.pending_ids == ()


def test_a_written_question_is_sent_without_its_model_answer():
    safe = strip_answers(
        {
            "questionId": "w1",
            "position": 0,
            "prompt": "Explain the second law.",
            "kind": "written",
            "options": [],
            "points": 4,
            "modelAnswer": "Entropy of an isolated system never decreases.",
            "correctIndex": 0,
        }
    )
    assert "modelAnswer" not in safe
    assert "correctIndex" not in safe
    assert safe["kind"] == "written"


# ----------------------------------------------------------------------
# Multi answer questions
# ----------------------------------------------------------------------

from app.services.quiz_service import MULTI  # noqa: E402

MULTI_Q = [
    Question(question_id="m1", kind=MULTI, correct_indexes=(0, 2), points=2),
]


def test_every_correct_option_and_no_others_scores():
    assert mark(MULTI_Q, {"m1": [0, 2]}).score == 2
    assert mark(MULTI_Q, {"m1": [2, 0]}).score == 2, "order must not matter"


def test_a_partly_right_multi_answer_scores_nothing_automatically():
    """All or nothing, and a teacher can still award part marks by hand.

    "Which of these three are true" has no defensible automatic way to
    score two out of three against a student who simply ticked every
    box. The judgement belongs to a person, and the override path is
    where it goes.
    """
    assert mark(MULTI_Q, {"m1": [0]}).score == 0
    assert mark(MULTI_Q, {"m1": [0, 1, 2]}).score == 0, "ticking everything must not pass"
    part = mark(MULTI_Q, {"m1": [0]}, awarded={"m1": 1})
    assert part.score == 1


def test_a_single_answer_is_the_one_element_case():
    """The two kinds share a code path so they cannot drift apart."""
    single = Question(question_id="s", correct_index=1, points=1)
    assert single.answer_set == frozenset({1})
    assert mark([single], {"s": 1}).score == 1
    # A bare index still works on a multi question with one right answer.
    one = Question(question_id="o", kind=MULTI, correct_indexes=(1,), points=1)
    assert mark([one], {"o": 1}).score == 1


def test_an_empty_selection_counts_as_unanswered():
    m = mark(MULTI_Q, {"m1": []})
    assert m.score == 0
    assert "m1" in m.unanswered_ids


@pytest.mark.parametrize("rubbish", [["a"], [True], [1.5], "0", {"a": 1}, [None]])
def test_a_malformed_selection_is_wrong_not_a_crash(rubbish):
    m = mark(MULTI_Q, {"m1": rubbish})
    assert m.score == 0


def test_a_student_is_told_how_many_to_pick_but_not_which():
    """Otherwise the question is unanswerable.

    The count gives nothing away: knowing two of five are right still
    leaves ten combinations.
    """
    safe = strip_answers(
        {
            "questionId": "m1",
            "position": 0,
            "prompt": "Which of these are noble gases?",
            "kind": "multi",
            "options": ["Neon", "Oxygen", "Argon", "Iron"],
            "points": 2,
            "correctIndexes": [0, 2],
        }
    )
    assert safe["correctCount"] == 2
    assert "correctIndexes" not in safe
    assert "correctIndex" not in safe

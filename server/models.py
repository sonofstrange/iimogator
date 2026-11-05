import re
from pydantic import BaseModel, model_validator


class Note(BaseModel):
    heading: str = ""
    paragraphs: list[str] = []


class StudyMaterial(BaseModel):
    title: str = ""
    notes: list[Note] = []
    summary: str = ""
    theses: list[str] = []

    @model_validator(mode='after')
    def check_length(self):
        words = 0
        for note in self.notes:
            for paragraph in note.paragraphs:
                words += len(paragraph.split())
        if words > 320:
            raise ValueError("Слишком длинный конспект")
        return self


class Pair(BaseModel):
    left: str = ""
    right: str = ""


class Question(BaseModel):
    type: str = "single"
    prompt: str = ""
    options: list[str] = []
    correct: list[int] = []
    accepted_answers: list[str] = []
    pairs: list[Pair] = []
    explanation: str = ""

    @model_validator(mode='after')
    def check_question(self):
        if self.type not in ('single', 'multiple', 'short', 'matching'):
            raise ValueError('Неизвестный тип')
        if self.type in ('single', 'multiple'):
            if not self.correct:
                raise ValueError("Некорректный ответ")
            for index in self.correct:
                if index < 0 or index >= len(self.options):
                    raise ValueError("Некорректный ответ")
        if self.type == 'matching':
            left_values = [pair.left for pair in self.pairs]
            if len(set(left_values)) != len(left_values):
                raise ValueError("Дубликаты в парах")
        return self


class Quiz(BaseModel):
    title: str = ""
    questions: list[Question] = []


class GenerationRequest(BaseModel):
    source_id: str = ""


class QuizRequest(GenerationRequest):
    difficulty: str = 'medium'
    count: int = 5


class Submission(BaseModel):
    answers: dict = {}


class ShortJudgement(BaseModel):
    id: str = ""
    correct: bool = False
    explanation: str = ""


class ShortJudgements(BaseModel):
    results: list[ShortJudgement] = []


def normalize_answer(value):
    return re.sub(r'\s+', ' ', value.casefold().replace('ё', 'е')).strip(' \t\r\n.,!?;:')


def grade_question(question, answer):
    if question.type == 'matching':
        correct = {}
        lines = []
        for index, pair in enumerate(question.pairs):
            correct[str(index)] = pair.right
            lines.append(f'{pair.left} - {pair.right}')
        ok = isinstance(answer, dict) and answer == correct
        display = '\n'.join(lines)
    elif question.type == 'short':
        accepted = [normalize_answer(item) for item in question.accepted_answers]
        ok = isinstance(answer, str) and normalize_answer(answer) in accepted
        display = question.accepted_answers[0] if question.accepted_answers else ""
    elif question.type == 'multiple':
        ok = isinstance(answer, list)
        if ok:
            for item in answer:
                if type(item) is not int:
                    ok = False
                    break
        if ok:
            ok = set(answer) == set(question.correct)
        answers = [question.options[index] for index in question.correct]
        display = '; '.join(answers)
    else:
        ok = type(answer) is int and bool(question.correct) and answer == question.correct[0]
        display = question.options[question.correct[0]] if question.correct else ""
    return {'correct': ok, 'correct_answer': display, 'explanation': question.explanation}

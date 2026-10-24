"""Legacy Python bot answers loaded from environment variables.

Candidate facts must not be committed to source control. Empty or negative
sentinel defaults intentionally fail the existing validator for required facts,
so the bot stops before opening a browser instead of submitting invented data.
"""

import os


def _integer(name: str, default: int = -1) -> int:
    raw_value = os.getenv(name)
    if raw_value is None or raw_value.strip() == "":
        return default
    return int(raw_value)


def _boolean(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes"}


default_resume_path = os.getenv("JOBPILOT_RESUME_PATH", "all resumes/default")
years_of_experience = os.getenv("JOBPILOT_YEARS_EXPERIENCE", "")
require_visa = os.getenv("JOBPILOT_REQUIRE_VISA", "")
website = os.getenv("JOBPILOT_WEBSITE", "")
linkedIn = os.getenv("JOBPILOT_LINKEDIN_URL", "")
us_citizenship = os.getenv("JOBPILOT_WORK_AUTHORIZATION", "")
desired_salary = _integer("JOBPILOT_DESIRED_SALARY")
current_ctc = _integer("JOBPILOT_CURRENT_CTC")
notice_period = _integer("JOBPILOT_NOTICE_PERIOD")
linkedin_headline = os.getenv("JOBPILOT_LINKEDIN_HEADLINE", "")
linkedin_summary = os.getenv("JOBPILOT_LINKEDIN_SUMMARY", "")
cover_letter = os.getenv("JOBPILOT_COVER_LETTER", "")
user_information_all = os.getenv("JOBPILOT_CANDIDATE_CONTEXT", "")
recent_employer = os.getenv("JOBPILOT_RECENT_EMPLOYER", "")
confidence_level = os.getenv("JOBPILOT_CONFIDENCE_LEVEL", "")

pause_before_submit = _boolean("JOBPILOT_PAUSE_BEFORE_SUBMIT", False)
pause_at_failed_question = _boolean("JOBPILOT_PAUSE_AT_FAILED_QUESTION", False)
overwrite_previous_answers = _boolean("JOBPILOT_OVERWRITE_ANSWERS", False)
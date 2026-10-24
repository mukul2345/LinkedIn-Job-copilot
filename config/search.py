"""Legacy Python bot search settings loaded from environment variables.

Search terms, locations, and candidate qualifications are explicit user input.
They must not be committed as source defaults.
"""

import json
import os


def _list(name: str) -> list[str]:
    raw_value = os.getenv(name, "")
    if not raw_value.strip():
        return []
    parsed_value = json.loads(raw_value)
    if not isinstance(parsed_value, list) or not all(isinstance(item, str) for item in parsed_value):
        raise ValueError(f"{name} must be a JSON array of strings")
    return parsed_value


def _boolean(name: str, default=None):
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes"}


search_terms = _list("JOBPILOT_SEARCH_TERMS")
search_location = os.getenv("JOBPILOT_SEARCH_LOCATION", "")
switch_number = int(os.getenv("JOBPILOT_SEARCH_SWITCH_COUNT", "5"))
randomize_search_order = _boolean("JOBPILOT_RANDOMIZE_SEARCH", False)
sort_by = os.getenv("JOBPILOT_SORT_BY", "")
date_posted = os.getenv("JOBPILOT_DATE_POSTED", "")
salary = os.getenv("JOBPILOT_SALARY_FILTER", "")
easy_apply_only = _boolean("JOBPILOT_EASY_APPLY_ONLY", True)

experience_level = _list("JOBPILOT_EXPERIENCE_LEVELS")
job_type = _list("JOBPILOT_JOB_TYPES")
on_site = _list("JOBPILOT_WORKPLACE_TYPES")
companies = _list("JOBPILOT_COMPANIES")
location = _list("JOBPILOT_LOCATION_FILTERS")
industry = _list("JOBPILOT_INDUSTRIES")
job_function = _list("JOBPILOT_JOB_FUNCTIONS")
job_titles = _list("JOBPILOT_JOB_TITLES")
benefits = _list("JOBPILOT_BENEFITS")
commitments = _list("JOBPILOT_COMMITMENTS")

under_10_applicants = _boolean("JOBPILOT_UNDER_10_APPLICANTS", False)
in_your_network = _boolean("JOBPILOT_IN_YOUR_NETWORK", False)
fair_chance_employer = _boolean("JOBPILOT_FAIR_CHANCE_EMPLOYER", False)
pause_after_filters = _boolean("JOBPILOT_PAUSE_AFTER_FILTERS", True)

about_company_bad_words = _list("JOBPILOT_COMPANY_EXCLUDED_WORDS")
about_company_good_words = _list("JOBPILOT_COMPANY_PREFERRED_WORDS")
bad_words = _list("JOBPILOT_JOB_EXCLUDED_WORDS")

# These candidate facts intentionally remain invalid until explicitly supplied.
security_clearance = _boolean("JOBPILOT_SECURITY_CLEARANCE")
did_masters = _boolean("JOBPILOT_DID_MASTERS")
current_experience = int(os.getenv("JOBPILOT_CURRENT_EXPERIENCE", "-2"))
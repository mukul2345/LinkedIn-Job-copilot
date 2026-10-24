const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('deployable security and privacy contracts', () => {
  it('should deny client access to system records and nested user writes', () => {
    const rules = read('firestore.rules');
    expect(rules).toContain('match /system/{document=**}');
    expect(rules).toMatch(/match \/system\/\{document=\*\*\}[\s\S]*allow read, write: if false;/);
    expect(rules).toMatch(/match \/users\/\{uid}\/{document=\*\*\}[\s\S]*allow write: if false;/);
    expect(rules).not.toContain('allow read, write: if request.auth != null;');
  });

  it('should constrain resume ownership, size, type, and filename', () => {
    const rules = read('storage.rules');
    expect(rules).toContain('request.auth.uid == userId');
    expect(rules).toContain('request.resource.size <= 5 * 1024 * 1024');
    expect(rules).toContain("'application/pdf'");
    expect(rules).toContain("'application/vnd.openxmlformats-officedocument.wordprocessingml.document'");
    expect(rules).toContain("fileName.matches('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\\\\.(pdf|docx)$')");
  });

  it('should move legacy candidate facts and search input to environment variables', () => {
    const questions = read('config/questions.py');
    const search = read('config/search.py');
    expect(questions).toContain('JOBPILOT_YEARS_EXPERIENCE');
    expect(questions).toContain('JOBPILOT_CANDIDATE_CONTEXT');
    expect(search).toContain('JOBPILOT_SEARCH_TERMS');
    expect(search).toContain('JOBPILOT_SEARCH_LOCATION');
    expect(search).toContain('candidate facts intentionally remain invalid');
  });

  it('should disclose actual data processing without legacy password claims', () => {
    const privacy = read('docs/privacy.html');
    expect(privacy).toContain('does not collect or store LinkedIn passwords');
    expect(privacy).toContain('Configured AI providers');
    expect(privacy).toContain('Opening an external application page is not recorded as submission');
    expect(privacy).toContain('Cashfree or Razorpay');
    expect(privacy).not.toContain('stored locally in your browser only');
  });
});
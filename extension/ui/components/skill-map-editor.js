// skill-map-editor.js - Dynamic key-value editor for skill → years of experience mapping
// Renders an editable list in the popup UI. Users add/remove/edit skills.

/**
 * Render the skill map editor into the given container.
 * @param {Element} container - DOM element to render into
 * @param {object} skillMap - Current skill map { skillName: years, ... }
 */
function renderSkillMapEditor(container, skillMap) {
  container.innerHTML = '';

  const entries = Object.entries(skillMap || {});

  if (entries.length === 0) {
    // Show empty state with hint
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'No skills added yet. Add your skills below so the bot can fill experience fields accurately.';
    container.appendChild(hint);
  }

  // Render each skill row
  entries.forEach(([skill, years]) => {
    container.appendChild(createSkillRow(skill, years));
  });

  // Add button
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-secondary btn-sm';
  addBtn.textContent = '+ Add Skill';
  addBtn.style.marginTop = '8px';
  addBtn.addEventListener('click', () => {
    // Insert new empty row before the Add button
    container.insertBefore(createSkillRow('', ''), addBtn);
  });
  container.appendChild(addBtn);
}

/**
 * Create a single skill row element.
 * @param {string} skill - Skill name
 * @param {string|number} years - Years of experience
 * @returns {Element}
 */
function createSkillRow(skill, years) {
  const row = document.createElement('div');
  row.className = 'skill-row';
  row.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 6px;';

  const skillInput = document.createElement('input');
  skillInput.type = 'text';
  skillInput.placeholder = 'Skill (e.g. Python, AWS)';
  skillInput.value = skill;
  skillInput.className = 'skill-name-input';
  skillInput.style.cssText = 'flex: 2; padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: inherit; font-size: 13px;';

  const yearsInput = document.createElement('input');
  yearsInput.type = 'number';
  yearsInput.placeholder = 'Yrs';
  yearsInput.value = years;
  yearsInput.min = '0';
  yearsInput.max = '30';
  yearsInput.className = 'skill-years-input';
  yearsInput.style.cssText = 'width: 55px; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: inherit; font-size: 13px; text-align: center;';

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '✕';
  deleteBtn.className = 'btn-icon';
  deleteBtn.title = 'Remove skill';
  deleteBtn.style.cssText = 'background: none; border: none; color: #ef4444; cursor: pointer; font-size: 16px; padding: 4px 8px; border-radius: 4px;';
  deleteBtn.addEventListener('click', () => row.remove());

  row.appendChild(skillInput);
  row.appendChild(yearsInput);
  row.appendChild(deleteBtn);
  return row;
}

/**
 * Read all skill entries from the editor and return as an object.
 * Skips empty rows.
 * @param {Element} container - The skill editor container
 * @returns {object} - { skillName: years, ... }
 */
function getSkillMapFromEditor(container) {
  const map = {};
  const rows = container.querySelectorAll('.skill-row');

  rows.forEach(row => {
    const skillInput = row.querySelector('.skill-name-input');
    const yearsInput = row.querySelector('.skill-years-input');
    if (!skillInput || !yearsInput) return;

    const skill = skillInput.value.trim().toLowerCase();
    const years = parseInt(yearsInput.value) || 0;

    if (skill) {
      map[skill] = years;
    }
  });

  return map;
}

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createHarness(uid, callable) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const snippet = source.slice(source.indexOf('    let activeStaffRole = null;'), source.indexOf('    function renderAdminMembers()'));
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(id === 'founder-admin-panel' ? ['hidden'] : []);
      elements.set(id, {
        classList: {
          toggle(name, force) {
            const add = force === undefined ? !classes.has(name) : force;
            if (add) classes.add(name); else classes.delete(name);
          },
          add: (name) => classes.add(name),
          contains: (name) => classes.has(name)
        },
        textContent: '', replaceChildren() {}, setAttribute() {}
      });
    }
    return elements.get(id);
  }
  const user = { uid, getIdTokenResult: async () => ({ claims: { role: uid === 'founder' ? 'owner' : 'moderator' } }) };
  const context = {
    auth: { currentUser: user },
    document: { getElementById: element },
    functions: { httpsCallable: () => callable },
    isFounderCopyExempt: () => !!context.auth.currentUser && context.auth.currentUser.uid === 'founder',
    loadStaffList() {},
    showToast() {},
    console: { error() {} }
  };
  vm.createContext(context);
  vm.runInContext(snippet + `
    globalThis.setState = (own, role, ready) => { viewingOwnProfile = own; activeStaffRole = role; staffClaimReady = ready; };
    globalThis.update = updateAdminAccess;
    globalThis.toggle = toggleFounderAdminPanel;
    globalThis.sync = syncStaffClaim;
  `, context);
  return { context, element, user };
}

test('founder can open local preview when staff verification fails', async () => {
  const h = createHarness('founder', async () => { throw Error('function unavailable'); });
  h.context.setState(true, null, false);
  await h.context.sync(h.user, 'owner');
  assert.equal(h.element('founder-admin-button').classList.contains('hidden'), false);
  assert.equal(h.element('verified-staff-controls').classList.contains('hidden'), true);
  assert.equal(h.element('staff-access-retry').classList.contains('hidden'), false);
  h.context.toggle();
  assert.equal(h.element('founder-admin-panel').classList.contains('hidden'), false);
  assert.equal(h.element('founder-preview-controls').classList.contains('hidden'), false);
});

test('staff controls require verified role; founder gets controls after successful sync', async () => {
  const h = createHarness('founder', async () => ({ data: { role: 'owner' } }));
  h.context.setState(true, null, false);
  await h.context.sync(h.user, 'owner');
  assert.equal(h.element('verified-staff-controls').classList.contains('hidden'), false);
  assert.equal(h.element('staff-access-unavailable').classList.contains('hidden'), true);
  h.context.auth.currentUser = null;
  h.context.update();
  assert.equal(h.element('founder-admin-button').classList.contains('hidden'), true);
  assert.equal(h.element('founder-admin-panel').classList.contains('hidden'), true);
});

test('non-founder cannot open admin without a verified staff role or on another profile', () => {
  const h = createHarness('moderator', async () => ({ data: { role: 'moderator' } }));
  h.context.setState(true, 'moderator', false);
  h.context.update();
  assert.equal(h.element('founder-admin-button').classList.contains('hidden'), true);
  h.context.setState(true, 'moderator', true);
  h.context.update();
  assert.equal(h.element('founder-admin-button').classList.contains('hidden'), false);
  assert.equal(h.element('founder-preview-controls').classList.contains('hidden'), true);
  h.context.setState(false, 'moderator', true);
  h.context.update();
  assert.equal(h.element('founder-admin-button').classList.contains('hidden'), true);
});

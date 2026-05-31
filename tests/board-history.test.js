import { describe, it, expect } from 'vitest';
import { historyRoleFromCapability } from '../js/board-history.js';

// The board-history UI distinguishes owner / collaborator / viewer (getRoleInfo),
// but app.js never wrote 'owner', so the owner crown was unreachable. This maps
// the capability role ('owner' | 'edit' | 'view') to the history role.
describe('historyRoleFromCapability', () => {
  it('maps owner -> owner (so the crown badge is reachable)', () => {
    expect(historyRoleFromCapability('owner')).toBe('owner');
  });

  it('maps view -> viewer', () => {
    expect(historyRoleFromCapability('view')).toBe('viewer');
  });

  it('maps edit -> collaborator', () => {
    expect(historyRoleFromCapability('edit')).toBe('collaborator');
  });

  it('defaults unknown/null role to collaborator', () => {
    expect(historyRoleFromCapability(null)).toBe('collaborator');
    expect(historyRoleFromCapability(undefined)).toBe('collaborator');
    expect(historyRoleFromCapability('whatever')).toBe('collaborator');
  });
});

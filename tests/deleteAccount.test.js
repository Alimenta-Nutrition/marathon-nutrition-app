import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deletedTables, from, deleteUser } = vi.hoisted(() => {
  const deletedTables = [];
  const queries = {};

  function makeQuery(table) {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      delete: vi.fn(() => {
        deletedTables.push(table);
        return query;
      }),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      then(resolve, reject) {
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return query;
  }

  function from(table) {
    if (!queries[table]) queries[table] = makeQuery(table);
    return queries[table];
  }

  return {
    deletedTables,
    from,
    deleteUser: vi.fn(async () => ({ error: null })),
    queries,
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from,
    auth: {
      admin: {
        deleteUser,
      },
    },
  }),
}));

vi.mock('../api/lib/requestUser.js', () => ({
  getRequestUserId: vi.fn((req) => req.userId || null),
}));

vi.mock('../api/lib/appleClientSecret.js', () => ({
  generateAppleClientSecret: vi.fn(() => 'secret'),
}));

import handler from '../api/routes/delete-account.js';

function createRes() {
  return {
    headersSent: false,
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
}

describe('POST /api/delete-account', () => {
  beforeEach(() => {
    deletedTables.length = 0;
    deleteUser.mockClear();
    const profiles = from('user_profiles');
    profiles.maybeSingle
      .mockReset()
      .mockResolvedValueOnce({ data: { apple_refresh_token: null }, error: null })
      .mockResolvedValueOnce({ data: { id: 'profile-1' }, error: null });
    from('nutritionists').maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it('deletes normalized meals and day_settings along with legacy rows', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: { confirmationText: 'DELETE' },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deletedTables).toEqual(
      expect.arrayContaining([
        'meal_ratings',
        'saved_meals',
        'meal_completions',
        'meal_plans',
        'meals',
        'day_settings',
        'user_profiles',
      ])
    );
    expect(deleteUser).toHaveBeenCalledWith('auth-user-1');
  });

  it('does not delete meals when confirmation text is missing', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: { confirmationText: 'nope' },
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(deletedTables).toEqual([]);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

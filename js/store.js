// Everything that reads or writes your data goes through this file,
// so the screens never need to know the data lives in Supabase.

const DEFAULT_SYMPTOMS = [
  { name: 'Headache', rating: 'scale', locations: ['Forehead', 'Temples', 'Behind eyes', 'Back of head', 'One side'], show_on_today: true },
  { name: 'Belly pain', rating: 'scale', locations: ['Upper', 'Lower', 'Left side', 'Right side', 'All over'], show_on_today: true },
  { name: 'Bloating', rating: 'scale', locations: [], show_on_today: false },
  { name: 'Nausea', rating: 'scale', locations: [], show_on_today: false },
];

const DEFAULT_HABITS = ['Water 8+', 'Walk', 'Coffee < 2pm', 'Screens off 22h'];

// Supabase sends at most 1000 rows per request; bigger reads are fetched in pages of this size.
const PAGE_SIZE = 1000;

const Dates = {
  // 'YYYY-MM-DD' in local time: the calendar day an entry belongs to.
  key(date = new Date()) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  parse(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  },
  addDays(key, n) {
    const d = Dates.parse(key);
    d.setDate(d.getDate() + n);
    return Dates.key(d);
  },
  range(from, to) {
    const keys = [];
    for (let k = from; k <= to; k = Dates.addDays(k, 1)) keys.push(k);
    return keys;
  },
  month(year, month) {
    return Dates.range(Dates.key(new Date(year, month, 1)), Dates.key(new Date(year, month + 1, 0)));
  },
  // 'HH:MM', 24-hour.
  hhmm(date) {
    const d = new Date(date);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
  todayAt(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  },
};

const Store = {
  client: null,
  user: null,

  init() {
    const config = window.DAILY_LOG_CONFIG;
    if (!config) throw new Error('js/config.js is missing. Create it with: bash scripts/make-config.sh');
    this.client = supabase.createClient(config.supabaseUrl, config.supabaseKey);
  },

  // Supabase answers { data, error }; this turns the error into an exception.
  async run(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // Reads every row of a query, a page at a time. `build` makes a fresh query for each page.
  async all(build) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = await this.run(build().range(from, from + PAGE_SIZE - 1));
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  },

  table(name) {
    return this.client.from(name);
  },

  mine(row) {
    return { ...row, user_id: this.user.id };
  },

  // Inserts a new row, or updates the given fields of an existing one.
  save(table, row) {
    const query = row.id
      ? this.table(table).update(this.mine(row)).eq('id', row.id)
      : this.table(table).insert(this.mine(row));
    return this.run(query.select().single());
  },

  // Account ---------------------------------------------------------------

  async currentUser() {
    const { data } = await this.client.auth.getSession();
    this.user = data.session?.user ?? null;
    return this.user;
  },

  async signIn(email, password) {
    const data = await this.run(this.client.auth.signInWithPassword({ email, password }));
    this.user = data.user;
    return this.user;
  },

  // Returns the user when they can start right away, or null when Supabase
  // first wants them to confirm their email.
  async signUp(email, password) {
    const data = await this.run(this.client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: location.origin + location.pathname },
    }));
    this.user = data.session ? data.user : null;
    return this.user;
  },

  async signOut() {
    await this.client.auth.signOut();
    this.user = null;
  },

  // A new account starts with a few common symptoms and habits.
  async ensureDefaults() {
    const [symptoms, habits] = await Promise.all([
      this.run(this.table('symptoms').select('id').limit(1)),
      this.run(this.table('habits').select('id').limit(1)),
    ]);
    if (!symptoms.length) {
      await this.run(this.table('symptoms').insert(DEFAULT_SYMPTOMS.map((s, i) => this.mine({ ...s, position: i }))));
    }
    if (!habits.length) {
      await this.run(this.table('habits').insert(DEFAULT_HABITS.map((name, i) => this.mine({ name, position: i }))));
    }
  },

  // What you track -----------------------------------------------------------

  listSymptoms() {
    return this.run(this.table('symptoms').select('*').eq('archived', false).order('position').order('created_at'));
  },

  saveSymptom(symptom) {
    return this.save('symptoms', symptom);
  },

  listHabits() {
    return this.run(this.table('habits').select('*').eq('archived', false).order('position').order('created_at'));
  },

  saveHabit(habit) {
    return this.save('habits', habit);
  },

  // What happened --------------------------------------------------------------

  entries(from, to, kind = null) {
    return this.all(() => {
      let query = this.table('entries').select('*').gte('day', from).lte('day', to).order('at');
      if (kind) query = query.eq('kind', kind);
      return query;
    });
  },

  addEntry(entry) {
    return this.run(this.table('entries').insert(this.mine(entry)).select().single());
  },

  deleteEntry(id) {
    return this.run(this.table('entries').delete().eq('id', id));
  },

  days(from, to) {
    return this.all(() => this.table('days').select('*').gte('day', from).lte('day', to).order('day'));
  },

  // Saves only the fields given; the rest of that day's row stays as it was.
  saveDay(day, fields) {
    const row = this.mine({ day, ...fields, updated_at: new Date().toISOString() });
    return this.run(this.table('days').upsert(row, { onConflict: 'user_id,day' }).select().single());
  },

  marks(from, to) {
    return this.all(() => this.table('habit_marks').select('habit_id, day').gte('day', from).lte('day', to).order('day').order('habit_id'));
  },

  setMark(habitId, day, on) {
    if (on) {
      const row = this.mine({ habit_id: habitId, day });
      return this.run(this.table('habit_marks').upsert(row, { onConflict: 'habit_id,day', ignoreDuplicates: true }));
    }
    return this.run(this.table('habit_marks').delete().eq('habit_id', habitId).eq('day', day));
  },

  // The last few different meals, newest first, so they can be logged again in one tap.
  async recentMeals() {
    const meals = await this.run(this.table('entries').select('details').eq('kind', 'meal').order('at', { ascending: false }).limit(100));
    const seen = new Map();
    for (const { details } of meals) {
      const key = details.name?.toLowerCase();
      if (key && !seen.has(key)) seen.set(key, { name: details.name, tags: details.tags ?? [] });
    }
    return [...seen.values()].slice(0, 6);
  },

  async exportAll() {
    // Each table with a column that gives the pages a stable order.
    const order = { symptoms: 'created_at', habits: 'created_at', entries: 'at', days: 'day', habit_marks: 'day' };
    const tables = Object.keys(order);
    const rows = await Promise.all(tables.map((name) => this.all(() => this.table(name).select('*').order(order[name]))));
    return {
      exported_at: new Date().toISOString(),
      ...Object.fromEntries(tables.map((name, i) => [name, rows[i]])),
    };
  },
};

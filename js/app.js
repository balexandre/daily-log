// The Alpine.js component behind index.html: what each screen shows and what each button does.

const MEAL_TAGS = ['Dairy', 'Gluten', 'Fatty / fried', 'Spicy', 'Sugar', 'Caffeine', 'Alcohol', 'Processed meat', 'Beans / onion'];
const DRINK_TAGS = ['Caffeine', 'Alcohol', 'Sugar'];
const VIEWS = ['today', 'month', 'patterns', 'setup'];

const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : '');

function app() {
  return {
    ready: false,
    fatal: null,
    busy: false,
    user: null,
    auth: { mode: 'signin', email: '', password: '', message: '' },
    view: 'today',
    sheet: null,
    form: {},
    toast: null,
    toastTimer: null,

    symptoms: [],
    habits: [],
    today: Dates.key(),
    todayEntries: [],
    todayMarks: {},
    recentMeals: [],
    cursor: { year: new Date().getFullYear(), month: new Date().getMonth() },
    monthRows: [],
    patterns: { loaded: false, loggedDays: 0, findings: [], waiting: [], strips: { rows: [] } },

    MEAL_TAGS,
    DRINK_TAGS,

    async init() {
      try {
        Store.init();
      } catch (e) {
        this.fatal = e.message;
        this.ready = true;
        return;
      }
      window.addEventListener('hashchange', () => this.route());
      // An email link that failed (expired, already used) comes back as #error=…&error_description=…
      const linkError = new URLSearchParams(location.hash.slice(1)).get('error_description');
      if (linkError) {
        history.replaceState(null, '', location.pathname);
        this.auth.message = `${linkError}. If you already confirmed your account, just sign in.`;
      }
      try {
        this.user = await Store.currentUser();
        if (this.user) await this.afterSignIn();
      } catch (e) {
        this.showError(e);
      }
      this.ready = true;
    },

    async afterSignIn() {
      await Store.ensureDefaults();
      await this.loadLists();
      await this.route();
    },

    async loadLists() {
      [this.symptoms, this.habits] = await Promise.all([Store.listSymptoms(), Store.listHabits()]);
    },

    // Runs a button's action: shows any error as a toast and ignores double taps meanwhile.
    async attempt(action) {
      if (this.busy) return;
      this.busy = true;
      try {
        await action();
      } catch (e) {
        this.showError(e);
      } finally {
        this.busy = false;
      }
    },

    showError(e) {
      console.error(e);
      // PGRST205: Supabase can't find a table, so schema.sql hasn't been run yet.
      const message = e?.code === 'PGRST205'
        ? 'The database isn’t set up yet. Run supabase/schema.sql in Supabase’s SQL Editor, then reload.'
        : e?.message || 'Something went wrong';
      this.showToast(message, { error: true });
    },

    showToast(message, { undo = null, error = false } = {}) {
      clearTimeout(this.toastTimer);
      this.toast = { message, undo, error };
      this.toastTimer = setTimeout(() => (this.toast = null), error ? 6000 : 4000);
    },

    undoToast() {
      const undo = this.toast?.undo;
      this.toast = null;
      if (undo) this.attempt(undo);
    },

    // Navigation -----------------------------------------------------------

    go(view) {
      if (location.hash === `#${view}`) this.route();
      else location.hash = view;
    },

    async route() {
      const view = location.hash.slice(1);
      this.view = VIEWS.includes(view) ? view : 'today';
      this.sheet = null;
      if (!this.user) return;
      try {
        await this.load(this.view);
      } catch (e) {
        this.showError(e);
      }
    },

    load(view) {
      if (view === 'today') return this.loadToday();
      if (view === 'month') return this.loadMonth();
      if (view === 'patterns') return this.loadPatterns();
      return this.loadLists();
    },

    closeSheet() {
      this.sheet = null;
    },

    // Account --------------------------------------------------------------

    async submitAuth() {
      const { mode, email, password } = this.auth;
      this.auth.message = '';
      this.user = mode === 'signin' ? await Store.signIn(email, password) : await Store.signUp(email, password);
      if (!this.user) {
        this.auth = { ...this.auth, mode: 'signin', password: '', message: 'Check your email and confirm your account, then sign in here.' };
        return;
      }
      this.auth.password = '';
      await this.afterSignIn();
    },

    async signOut() {
      await Store.signOut();
      this.user = null;
      this.symptoms = [];
      this.habits = [];
      this.todayEntries = [];
      history.replaceState(null, '', location.pathname);
    },

    // Today ----------------------------------------------------------------

    get todayLabel() {
      return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    },

    get todaySymptoms() {
      return this.symptoms.filter((s) => s.show_on_today);
    },

    get checkinSymptoms() {
      return this.symptoms.filter((s) => s.ask_in_checkin);
    },

    symptomById(id) {
      return this.symptoms.find((s) => s.id === id);
    },

    timeOf(iso) {
      return Dates.hhmm(iso);
    },

    async loadToday() {
      this.today = Dates.key();
      const [entries, marks] = await Promise.all([
        Store.entries(this.today, this.today),
        Store.marks(this.today, this.today),
      ]);
      this.todayEntries = entries;
      this.todayMarks = Object.fromEntries(marks.map((m) => [m.habit_id, true]));
    },

    async toggleToday(habitId) {
      const on = !this.todayMarks[habitId];
      this.todayMarks[habitId] = on;
      try {
        await Store.setMark(habitId, this.today, on);
      } catch (e) {
        this.todayMarks[habitId] = !on;
        this.showError(e);
      }
    },

    async addEntry({ at = new Date(), ...entry }, message = 'Saved') {
      const saved = await Store.addEntry({ ...entry, at: at.toISOString(), day: Dates.key(at) });
      if (saved.day === this.today) {
        this.todayEntries = [...this.todayEntries, saved].sort((a, b) => a.at.localeCompare(b.at));
      }
      this.sheet = null;
      this.showToast(message, { undo: () => this.removeEntry(saved) });
      return saved;
    },

    async removeEntry(entry) {
      await Store.deleteEntry(entry.id);
      this.todayEntries = this.todayEntries.filter((e) => e.id !== entry.id);
    },

    async confirmRemove(entry) {
      if (confirm(`Delete “${this.describe(entry).title}”?`)) await this.removeEntry(entry);
    },

    quickAdd(kind) {
      return this.addEntry({ kind, details: {} }, { coffee: 'Coffee +1', water: 'Water +1' }[kind]);
    },

    // How an entry reads in the timeline.
    describe(entry) {
      const d = entry.details || {};
      switch (entry.kind) {
        case 'symptom': {
          const name = this.symptomById(entry.symptom_id)?.name ?? d.name ?? 'Symptom';
          return {
            symptom: true,
            title: name + (entry.severity ? ` · ${entry.severity}/10` : ''),
            sub: [d.location, d.note].filter(Boolean).join(' · '),
            tags: [],
          };
        }
        case 'meal': {
          const portion = d.portion && d.portion !== 'normal' ? `${d.portion} portion` : null;
          return { title: `${capitalize(d.meal)} · ${d.name}`, tags: [...(d.tags ?? []), portion].filter(Boolean) };
        }
        case 'coffee': return { title: 'Coffee', tags: [] };
        case 'water': return { title: 'Water · 1 glass', tags: [] };
        case 'drink': return { title: `Drink · ${d.name}`, tags: d.tags ?? [] };
        case 'stress': return { title: `Stress · ${d.level}`, tags: [] };
        case 'exercise': return { title: capitalize(d.type) + (d.minutes ? ` · ${d.minutes} min` : ''), tags: [] };
        case 'meds': return { title: `Meds · ${d.name}`, tags: [] };
        default: return { title: capitalize(entry.kind), tags: [] };
      }
    },

    toggle(list, value) {
      const i = list.indexOf(value);
      if (i === -1) list.push(value);
      else list.splice(i, 1);
    },

    // Log a symptom --------------------------------------------------------

    openSymptom(id = null) {
      const symptom = id
        ? this.symptomById(id)
        : this.symptoms.find((s) => !s.show_on_today) ?? this.symptoms[0];
      this.form = { symptomId: symptom?.id ?? null, severity: 5, location: null, ago: 0, time: Dates.hhmm(new Date()), note: '' };
      this.sheet = 'symptom';
    },

    get formSymptom() {
      return this.symptomById(this.form.symptomId);
    },

    pickSymptom(id) {
      this.form.symptomId = id;
      this.form.location = null;
    },

    severityLabel(n) {
      return n <= 3 ? 'Mild' : n <= 6 ? 'Moderate' : n <= 8 ? 'Severe' : 'Very severe';
    },

    saveSymptomEntry() {
      const symptom = this.formSymptom;
      if (!symptom) throw new Error('Pick a symptom first');
      const at = this.form.ago === 'custom' ? Dates.todayAt(this.form.time) : new Date(Date.now() - this.form.ago * 60000);
      return this.addEntry({
        kind: 'symptom',
        symptom_id: symptom.id,
        severity: symptom.rating === 'scale' ? this.form.severity : null,
        at,
        details: { name: symptom.name, location: this.form.location, note: this.form.note.trim() || null },
      }, `${symptom.name} logged`);
    },

    // Log a meal -----------------------------------------------------------

    async openMeal() {
      const hour = new Date().getHours();
      const meal = hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : hour < 22 ? 'dinner' : 'snack';
      this.form = { meal, name: '', tags: [], portion: 'normal', time: Dates.hhmm(new Date()) };
      this.sheet = 'meal';
      this.recentMeals = await Store.recentMeals();
    },

    useRecentMeal(meal) {
      this.form.name = meal.name;
      this.form.tags = [...meal.tags];
    },

    // Typing a meal you've had before fills in its tags.
    matchRecentMeal() {
      const typed = this.form.name.trim().toLowerCase();
      const match = this.recentMeals.find((m) => m.name.toLowerCase() === typed);
      if (match && !this.form.tags.length) this.form.tags = [...match.tags];
    },

    saveMeal() {
      const name = this.form.name.trim();
      if (!name) throw new Error('What did you eat?');
      return this.addEntry({
        kind: 'meal',
        at: Dates.todayAt(this.form.time),
        details: { meal: this.form.meal, name, tags: this.form.tags, portion: this.form.portion },
      }, `${capitalize(this.form.meal)} logged`);
    },

    // Drink, stress, exercise, meds -----------------------------------------

    openQuick(kind) {
      this.form = { kind, name: '', tags: [], level: 'medium', type: 'walk', minutes: 20, time: Dates.hhmm(new Date()) };
      this.sheet = 'quick';
    },

    get quickTitle() {
      return { drink: 'Log a drink', stress: 'Log stress', exercise: 'Log exercise', meds: 'Log meds' }[this.form.kind];
    },

    saveQuick() {
      const { kind, name, tags, level, type, minutes, time } = this.form;
      const details = {
        drink: { name: name.trim(), tags },
        stress: { level },
        exercise: { type, minutes: Number(minutes) || null },
        meds: { name: name.trim() },
      }[kind];
      if (kind === 'drink' && !details.name) throw new Error('What did you drink?');
      if (kind === 'meds' && !details.name) throw new Error('Which meds?');
      return this.addEntry({ kind, at: Dates.todayAt(time), details });
    },

    // Evening check-in -----------------------------------------------------

    async openCheckin() {
      const [row] = await Store.days(this.today, this.today);
      const waterLogged = this.todayEntries.filter((e) => e.kind === 'water').length;
      this.form = {
        sleep_hours: row?.sleep_hours != null ? Number(row.sleep_hours) : 7,
        sleep_quality: row?.sleep_quality ?? null,
        water_glasses: row?.water_glasses ?? waterLogged,
        stress: row?.stress ?? null,
        screen_time: row?.screen_time ?? null,
        exercise: row?.exercise ?? null,
        asks: Object.fromEntries(this.checkinSymptoms.map((s) => [
          s.id,
          this.todayEntries.some((e) => e.symptom_id === s.id) ? 'yes' : null,
        ])),
      };
      this.sheet = 'checkin';
    },

    stepSleep(delta) {
      this.form.sleep_hours = Math.min(14, Math.max(0, this.form.sleep_hours + delta));
    },

    formatHours(hours) {
      const minutes = Math.round(hours * 60);
      return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
    },

    // Tapping the glass that's already the last one full takes one away.
    setWater(glasses) {
      this.form.water_glasses = this.form.water_glasses === glasses ? glasses - 1 : glasses;
    },

    async saveCheckin() {
      const { asks, ...day } = this.form;
      await Store.saveDay(this.today, day);
      for (const symptom of this.checkinSymptoms) {
        const alreadyLogged = this.todayEntries.some((e) => e.symptom_id === symptom.id);
        if (asks[symptom.id] === 'yes' && !alreadyLogged) {
          await this.addEntry({ kind: 'symptom', symptom_id: symptom.id, details: { name: symptom.name, note: 'From evening check-in' } });
        }
      }
      this.sheet = null;
      this.showToast('Check-in saved');
    },

    // Month grid -----------------------------------------------------------

    get monthLabel() {
      return new Date(this.cursor.year, this.cursor.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    },

    // The symptom columns in the grid: the ones with a button on Today.
    get gridSymptoms() {
      return this.symptoms.filter((s) => s.show_on_today);
    },

    shiftMonth(delta) {
      const d = new Date(this.cursor.year, this.cursor.month + delta, 1);
      this.cursor = { year: d.getFullYear(), month: d.getMonth() };
      return this.loadMonth();
    },

    async loadMonth() {
      const keys = Dates.month(this.cursor.year, this.cursor.month);
      const from = keys[0];
      const to = keys[keys.length - 1];
      const [entries, days, marks] = await Promise.all([
        Store.entries(from, to, 'symptom'),
        Store.days(from, to),
        Store.marks(from, to),
      ]);
      const dayRows = Object.fromEntries(days.map((d) => [d.day, d]));
      const marked = new Set(marks.map((m) => `${m.habit_id}|${m.day}`));
      this.today = Dates.key();

      this.monthRows = keys.map((key) => {
        const date = Dates.parse(key);
        // Worst severity of each symptom that day; 0 means it happened without a rating.
        const severity = {};
        for (const e of entries) {
          if (e.day === key && e.symptom_id) severity[e.symptom_id] = Math.max(severity[e.symptom_id] ?? 0, e.severity ?? 0);
        }
        return {
          key,
          n: date.getDate(),
          wd: date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2),
          weekend: date.getDay() === 0 || date.getDay() === 6,
          isToday: key === this.today,
          future: key > this.today,
          note: dayRows[key]?.note ?? '',
          sleep: dayRows[key]?.sleep_hours != null ? Number(dayRows[key].sleep_hours) : null,
          marks: Object.fromEntries(this.habits.map((h) => [h.id, marked.has(`${h.id}|${key}`)])),
          severity,
        };
      });
    },

    async toggleMonth(row, habitId) {
      const on = !row.marks[habitId];
      row.marks[habitId] = on;
      try {
        await Store.setMark(habitId, row.key, on);
        if (row.isToday) this.todayMarks[habitId] = on;
      } catch (e) {
        row.marks[habitId] = !on;
        this.showError(e);
      }
    },

    habitTotal(habitId) {
      return this.monthRows.filter((r) => r.marks[habitId]).length;
    },

    symptomTotal(symptomId) {
      return this.monthRows.filter((r) => r.severity[symptomId] !== undefined).length;
    },

    get averageSleep() {
      const hours = this.monthRows.map((r) => r.sleep).filter((h) => h != null);
      return hours.length ? (hours.reduce((a, b) => a + b, 0) / hours.length).toFixed(1) : '–';
    },

    // Where a sleep dot sits on the 5–9 h scale, in percent.
    sleepPercent(hours) {
      return Math.max(0, Math.min(100, ((hours - 5) / 4) * 100));
    },

    openNote(row) {
      const label = Dates.parse(row.key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
      this.form = { day: row.key, label, note: row.note };
      this.sheet = 'note';
    },

    async saveNote() {
      const note = this.form.note.trim();
      await Store.saveDay(this.form.day, { note: note || null });
      const row = this.monthRows.find((r) => r.key === this.form.day);
      if (row) row.note = note;
      this.sheet = null;
      this.showToast('Note saved');
    },

    // Patterns -------------------------------------------------------------

    async loadPatterns() {
      const to = Dates.key();
      const from = Dates.addDays(to, -59);
      const [entries, days, marks] = await Promise.all([Store.entries(from, to), Store.days(from, to), Store.marks(from, to)]);
      this.patterns = {
        loaded: true,
        ...Patterns.find({ symptoms: this.symptoms, habits: this.habits, entries, days, marks, from, to }),
      };
    },

    stripLabel(key) {
      return Dates.parse(key).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    },

    async exportData() {
      const data = await Store.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `daily-log-${Dates.key()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    },

    // Setup: symptoms and habits ------------------------------------------

    // `returnTo` reopens the symptom logger after creating a symptom from it.
    openSymptomEditor(symptom = null, returnTo = null) {
      this.form = symptom
        ? { id: symptom.id, name: symptom.name, rating: symptom.rating, locations: [...symptom.locations], show_on_today: symptom.show_on_today, ask_in_checkin: symptom.ask_in_checkin }
        : { name: '', rating: 'scale', locations: [], show_on_today: false, ask_in_checkin: false };
      this.form.newLocation = '';
      this.form.returnTo = returnTo;
      this.sheet = 'symptomEditor';
    },

    addLocation() {
      const place = this.form.newLocation.trim();
      if (place && !this.form.locations.includes(place)) this.form.locations.push(place);
      this.form.newLocation = '';
    },

    async saveSymptom() {
      const { newLocation, returnTo, ...symptom } = this.form;
      symptom.name = symptom.name.trim();
      if (!symptom.name) throw new Error('Give the symptom a name');
      if (!symptom.id) symptom.position = this.symptoms.length;
      const saved = await Store.saveSymptom(symptom);
      await this.loadLists();
      if (returnTo === 'symptom') this.openSymptom(saved.id);
      else this.sheet = null;
      if (this.view === 'month') await this.loadMonth();
      this.showToast(`${saved.name} saved`);
    },

    async archiveSymptom() {
      if (!confirm(`Hide “${this.form.name}”? What you've already logged stays in your history.`)) return;
      await Store.saveSymptom({ id: this.form.id, archived: true });
      await this.loadLists();
      this.sheet = null;
    },

    openHabitEditor(habit = null) {
      this.form = habit ? { id: habit.id, name: habit.name } : { name: '' };
      this.sheet = 'habitEditor';
    },

    async saveHabit() {
      const habit = { ...this.form, name: this.form.name.trim() };
      if (!habit.name) throw new Error('Give the habit a name');
      if (!habit.id) habit.position = this.habits.length;
      await Store.saveHabit(habit);
      await this.loadLists();
      this.sheet = null;
      if (this.view === 'month') await this.loadMonth();
      this.showToast(`${habit.name} saved`);
    },

    async archiveHabit() {
      if (!confirm(`Remove “${this.form.name}” from the grid? Its past marks are kept.`)) return;
      await Store.saveHabit({ id: this.form.id, archived: true });
      await this.loadLists();
      this.sheet = null;
    },

    async moveHabit(index, delta) {
      const list = [...this.habits];
      const other = index + delta;
      if (other < 0 || other >= list.length) return;
      [list[index], list[other]] = [list[other], list[index]];
      await Promise.all(list.map((h, position) => Store.saveHabit({ id: h.id, position })));
      await this.loadLists();
    },
  };
}

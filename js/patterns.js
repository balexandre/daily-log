// Finds what tends to come before a symptom.
//
// For each symptom it splits your logged days in two: days the symptom happened
// and days it didn't. Then, for each possible trigger (short sleep, dairy,
// skipping a habit…), it compares how often the trigger shows up in each group.
// A trigger that's clearly more common on symptom days is reported.
// It's counting, not medicine: it shows what lines up, not what causes what.

const Patterns = {
  MIN_LOGGED_DAYS: 14,   // below this, there isn't enough to compare
  MIN_SYMPTOM_DAYS: 3,
  MIN_KNOWN_DAYS: 3,     // a trigger needs at least this many days with an answer, in each group
  MIN_GAP: 0.25,         // 25 percentage points more common on symptom days

  find({ symptoms, habits, entries, days, marks, from, to }) {
    const byDay = {};
    const dayOf = (key) => (byDay[key] ??= { entries: [], row: null, marks: new Set() });
    entries.forEach((e) => dayOf(e.day).entries.push(e));
    days.forEach((d) => (dayOf(d.day).row = d));
    marks.forEach((m) => dayOf(m.day).marks.add(m.habit_id));

    const logged = Dates.range(from, to).filter((key) => byDay[key]);
    const triggers = this.triggers(habits, entries);
    const findings = [];
    const waiting = [];

    for (const symptom of symptoms) {
      // The time of the first episode on each day, so only what came before it counts.
      const startedAt = {};
      for (const e of entries) {
        if (e.symptom_id === symptom.id && (!startedAt[e.day] || e.at < startedAt[e.day])) startedAt[e.day] = e.at;
      }
      const withSymptom = logged.filter((key) => startedAt[key]);
      const without = logged.filter((key) => !startedAt[key]);

      if (logged.length < this.MIN_LOGGED_DAYS || withSymptom.length < this.MIN_SYMPTOM_DAYS) {
        if (withSymptom.length) waiting.push({ name: symptom.name, days: withSymptom.length });
        continue;
      }

      for (const trigger of triggers) {
        const check = (key, cutoff) => trigger.test(byDay[key], cutoff, byDay[Dates.addDays(key, -1)]);
        const a = this.tally(withSymptom, (key) => check(key, startedAt[key]));
        const b = this.tally(without, (key) => check(key, null));
        if (a.known < this.MIN_KNOWN_DAYS || b.known < this.MIN_KNOWN_DAYS) continue;

        const share = a.yes / a.known;
        const gap = share - b.yes / b.known;
        if (gap < this.MIN_GAP) continue;

        findings.push({
          id: `${symptom.id}-${trigger.id}`,
          title: `${symptom.name} after ${trigger.label}`,
          text: `${a.yes} of ${a.known} ${symptom.name.toLowerCase()} days ${trigger.phrase}, compared with ${b.yes} of ${b.known} other days.`,
          share,
          gap,
          strength: gap >= 0.45 && a.known >= 5 ? 'Strong' : gap >= 0.3 ? 'Likely' : 'Possible',
        });
      }
    }

    findings.sort((x, y) => y.gap - x.gap);
    return {
      loggedDays: logged.length,
      findings: findings.slice(0, 8),
      waiting,
      strips: this.strips(symptoms, entries, days, to),
    };
  },

  // Counts yes answers among the days where the trigger could be answered at all.
  tally(keys, test) {
    let yes = 0;
    let known = 0;
    for (const key of keys) {
      const answer = test(key);
      if (answer === null || answer === undefined) continue;
      known++;
      if (answer) yes++;
    }
    return { yes, known };
  },

  // Each trigger answers, for one day: true, false, or null when that day doesn't say.
  // `cutoff` is when the symptom started (null on days without it); `previous` is the day before.
  triggers(habits, entries) {
    const before = (day, cutoff) => day.entries.filter((e) => !cutoff || e.at < cutoff);
    const hasTag = (e, tag) => (e.details?.tags ?? []).includes(tag);

    const list = [
      {
        id: 'short-sleep', label: 'short sleep', phrase: 'followed a night under 6.5 h',
        test: (day) => (day.row?.sleep_hours == null ? null : Number(day.row.sleep_hours) < 6.5),
      },
      {
        id: 'poor-sleep', label: 'a poor night', phrase: 'followed a poor night',
        test: (day) => (day.row?.sleep_quality ? day.row.sleep_quality === 'poor' : null),
      },
      {
        id: 'stress', label: 'a stressful day', phrase: 'were high-stress days',
        test: (day) => {
          if (day.entries.some((e) => e.kind === 'stress' && e.details?.level === 'high')) return true;
          return day.row?.stress ? day.row.stress === 'high' : null;
        },
      },
      {
        id: 'screens', label: 'long screen time', phrase: 'had 8 h or more of screens',
        test: (day) => (day.row?.screen_time ? day.row.screen_time === 'over8' : null),
      },
      {
        id: 'no-exercise', label: 'no exercise', phrase: 'had no exercise',
        test: (day) => {
          if (day.entries.some((e) => e.kind === 'exercise')) return false;
          return day.row?.exercise ? day.row.exercise === 'none' : null;
        },
      },
      {
        id: 'little-water', label: 'little water', phrase: 'had under 6 glasses of water',
        test: (day) => {
          const logged = day.entries.filter((e) => e.kind === 'water').length;
          if (day.row?.water_glasses == null && !logged) return null;
          return (day.row?.water_glasses ?? logged) < 6;
        },
      },
      {
        id: 'late-coffee', label: 'afternoon coffee', phrase: 'had coffee after 2 pm',
        test: (day, cutoff) => before(day, cutoff).some((e) => e.kind === 'coffee' && new Date(e.at).getHours() >= 14),
      },
      {
        id: 'alcohol-before', label: 'alcohol the day before', phrase: 'came after a day with alcohol',
        test: (day, cutoff, previous) => (previous ? previous.entries.some((e) => hasTag(e, 'Alcohol')) : null),
      },
    ];

    // Every tag you've used on a meal or drink (Dairy, Gluten, Spicy…).
    const tags = new Set(entries.flatMap((e) => e.details?.tags ?? []));
    for (const tag of tags) {
      list.push({
        id: `tag-${tag}`, label: tag.toLowerCase(), phrase: `had ${tag.toLowerCase()} before it started`,
        test: (day, cutoff) => before(day, cutoff).some((e) => hasTag(e, tag)),
      });
    }

    // Skipping a habit counts only on days where you used the grid at all.
    for (const habit of habits) {
      list.push({
        id: `habit-${habit.id}`, label: `skipping “${habit.name}”`, phrase: `skipped “${habit.name}”`,
        test: (day) => (day.marks.size ? !day.marks.has(habit.id) : null),
      });
    }

    return list;
  },

  // One strip of 30 squares per symptom, plus short-sleep nights, ending today.
  strips(symptoms, entries, days, to) {
    const keys = Dates.range(Dates.addDays(to, -29), to);
    const rows = symptoms
      .map((symptom) => {
        const on = new Set(entries.filter((e) => e.symptom_id === symptom.id).map((e) => e.day));
        return { label: symptom.name, kind: 'symptom', cells: keys.map((key) => ({ key, on: on.has(key) })) };
      })
      .filter((row) => row.cells.some((cell) => cell.on));
    const short = new Set(days.filter((d) => d.sleep_hours != null && Number(d.sleep_hours) < 6.5).map((d) => d.day));
    rows.push({ label: 'Sleep < 6.5 h', kind: 'sleep', cells: keys.map((key) => ({ key, on: short.has(key) })) });
    return { from: keys[0], to, rows };
  },
};

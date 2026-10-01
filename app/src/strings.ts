// Every piece of text the user sees, grouped by screen. Text with values in it
// is a function, so each language can order words its own way.
//
// To add a language: write `const tr: Strings = { ... }` next to `en`
// (TypeScript flags any missing key) and pick one in `strings` below.
const en = {
  common: {
    cancel: 'Cancel',
    saved: 'Saved ✓',
    tryAgain: 'Try again',
    requestFailed: (status: number) => `Request failed (${status})`,
  },

  format: {
    months: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    shortMonths: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ],
    shortDate: (month: string, day: number) => `${month} ${day}`,
    shortDateWithYear: (month: string, day: number, year: number) =>
      `${month} ${day}, ${year}`,
    postedDate: (month: string, day: number, year: number) =>
      `${month} ${day}, ${year}`,
    minutes: (minutes: number) => `${minutes} min`,
    hours: (hours: number) => `${hours} hr`,
    hoursAndMinutes: (hours: number, minutes: number) =>
      `${hours} hr ${minutes} min`,
    serves: (servings: number) => `Serves ${servings}`,
    today: 'Today',
    yesterday: 'Yesterday',
    justNow: 'just now',
    minutesAgo: (minutes: number) => `${minutes} min ago`,
    hoursAgo: (hours: number) => `${hours} h ago`,
    daysAgo: (days: number) => `${days} day${days === 1 ? '' : 's'} ago`,
    ingredientCount: (count: number) =>
      `${count} ingredient${count === 1 ? '' : 's'}`,
  },

  validation: {
    emailRequired: 'Email is required',
    emailInvalid: 'Enter a valid email address',
    passwordRequired: 'Password is required',
    nameRequired: 'Name is required',
    passwordTooShort: (min: number) =>
      `Password must be at least ${min} characters`,
    passwordTooLong: (max: number) =>
      `Password must be at most ${max} characters`,
    confirmPasswordRequired: 'Please confirm your password',
    passwordsDontMatch: 'Passwords do not match',
    titleRequired: 'Title is required',
    titleTooLong: 'Title is too long',
    sourceTooLong: 'Keep it under 100 characters',
    wholeNumber: (label: string) => `${label} must be a whole number`,
    atMost: (label: string, max: number) => `${label} must be at most ${max}`,
    imageUrlInvalid: 'Enter a link starting with http:// or https://',
    ingredientsRequired: 'Add at least one ingredient',
    instructionsRequired: 'Add at least one step',
    ingredientsOnlyHeadings: 'Add at least one ingredient, not just headings',
    instructionsOnlyHeadings: 'Add at least one step, not just headings',
    // Field names used inside the messages above.
    prepTime: 'Prep time',
    cookTime: 'Cook time',
    servings: 'Servings',
  },

  appName: 'Flourish',

  login: {
    title: 'Welcome back',
    subhead: 'Your recipes, and every time you cooked them.',
    emailPlaceholder: 'Email',
    passwordPlaceholder: 'Password',
    submit: 'Log in',
    failed: 'Sign in failed',
    registerLinkQuestion: "Don't have an account?",
    registerLinkAction: 'Sign up',
  },

  register: {
    title: 'Start your recipe book',
    subhead: 'Save recipes, log what you ate, see what to add.',
    namePlaceholder: 'Name',
    emailPlaceholder: 'Email',
    passwordPlaceholder: 'Password',
    confirmPasswordPlaceholder: 'Confirm password',
    submit: 'Sign up',
    failed: 'Sign up failed',
    loginLinkQuestion: 'Already have an account?',
    loginLinkAction: 'Log in',
  },

  recipeList: {
    headerTitle: 'Recipes',
    signOut: 'Sign out',
    kicker: 'FROM MY KITCHEN',
    greeting: (firstName: string) =>
      `Hi ${firstName}, what are we cooking today?`,
    greetingNoName: 'What are we cooking today?',
    recipeCount: (count: number) =>
      `${count} recipe${count === 1 ? '' : 's'}, each with a story.`,
    emptyTitle: 'The recipe box is empty.',
    emptyText: 'Every good story starts with a first recipe.',
    newRecipe: '＋ New recipe',
    forkedFrom: (title: string) => `from ${title}`,
    ingredientsLink: 'Ingredients',
    // Search and filters above the list.
    searchPlaceholder: 'Search recipes and ingredients',
    timeLabel: 'Time',
    anyTime: 'Any time',
    upTo: (minutes: number) =>
      minutes >= 60 ? `Up to ${minutes / 60} h` : `Up to ${minutes} min`,
    fromLabel: 'From',
    fromAnywhere: 'From anywhere',
    from: (source: string) => `From ${source}`,
    filters: 'Filters',
    filtersOnLabel: (count: number) => `Filters, ${count} on`,
    noMatch: 'No recipes match.',
    clearFilters: 'Clear filters',
  },

  // Neutral nutrition words only.
  ingredients: {
    headerTitle: 'Ingredients',
    searchPlaceholder: 'Search ingredients',
    all: 'All',
    groups: {
      PROTEIN: 'Protein',
      FIBER: 'Fiber',
      HEALTHY_FAT: 'Healthy fat',
      CARB: 'Carb',
    },
    // Read out for a row's chips: "Mainly healthy fat, also fiber".
    groupsLabel: (main: string | null, also: string[]) =>
      [
        ...(main ? [`Mainly ${main.toLowerCase()}`] : []),
        ...(also.length
          ? [`${main ? 'also' : 'Has'} ${also.join(', ').toLowerCase()}`]
          : []),
      ].join(', '),
    noMatch: (query: string) => `No "${query}" yet.`,
    empty: 'No ingredients here yet.',
    // Detail. A seasoning has no groups, so its dots read this.
    noGroups: "Doesn't count toward a balanced plate",
    mainly: 'Mainly',
    also: 'Also has',
    inYourRecipes: 'IN YOUR RECIPES',
    notUsedYet: "You haven't used this in a recipe yet.",
    usdaLink: 'Source: USDA FoodData Central ›',
    usdaLinkFailed: "Couldn't open the USDA page",
    loadFailed: "Couldn't load this ingredient.",
  },

  // "Was it enjoyable to make?" on attempts: the effort, not the taste.
  enjoyment: {
    question: 'Was it enjoyable to make?',
    // The finish sheet's photo of what came out.
    photoTitle: 'A photo of what you made',
    photoLabel: 'Photo of what you made',
    cameraError: "Couldn't open the camera. You can still choose a photo.",
    LOVED: 'Loved making it',
    FINE: 'It was fine',
    NOT_WORTH_IT: 'Not worth the effort',
  },

  // "How did you feel after?" on meals and attempts. None is the right answer.
  fullness: {
    question: 'How did you feel after?',
    STILL_HUNGRY: 'Still hungry',
    SATISFIED: 'Satisfied',
    VERY_FULL: 'Very full',
  },

  addMeal: {
    entry: '＋ Add what you ate',
    title: 'What did you eat?',
    meal: 'Meal',
    snack: 'Snack',
    takePhoto: 'Take photo',
    choosePhoto: 'Choose photo',
    removePhoto: 'Remove photo',
    photoLabel: 'Your meal photo',
    textLabel: 'What was in it?',
    optional: 'Optional',
    textPlaceholder: 'leftover pasta, spinach',
    recentSnacks: 'Recent snacks',
    when: 'When',
    today: 'Today',
    yesterday: 'Yesterday',
    save: 'Save',
    needsSomething: 'Add a photo or what was in it.',
    saveFailed: "Couldn't save. Check your connection and try again.",
    cameraError: "Couldn't open the camera. You can still choose a photo.",
    saved: 'Saved ✓',
    // After saving: what the meal brought, then one thing to add next time.
    // "Protein, fiber and healthy fat in this."
    inThis: (has: string[]) => {
      if (has.length === 0) return 'No protein, fiber or healthy fat found.';
      const words = has.map(word => word.toLowerCase());
      const last = words.pop()!;
      const list = words.length ? `${words.join(', ')} and ${last}` : last;
      return `${list.charAt(0).toUpperCase()}${list.slice(1)} in this.`;
    },
    photoOnly: 'Add what was in it to see the balance.',
    addNextTime: {
      PROTEIN: 'Add a protein next time.',
      FIBER: 'Add some fiber next time.',
      HEALTHY_FAT: 'Add a healthy fat next time.',
    },
    done: 'Done',
  },

  week: {
    link: 'Your week ›',
    title: 'Your week',
    previous: 'Previous week',
    next: 'Next week',
    days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    dayNames: [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ],
    nothingLogged: 'Nothing logged',
    empty: 'Nothing logged this week. Add what you ate, a photo is enough.',
    loadFailed: "Couldn't load your week.",
    kinds: { MEAL: 'Meal', SNACK: 'Snack' },
    // Tag on a tile for a recipe cooked that day.
    cooked: 'Cooked',
    // Read out for a tile: "Meal, Wednesday, leftover pasta, Satisfied".
    tileLabel: (parts: (string | null)[]) =>
      parts.filter(part => part).join(', '),
    // "Protein in most meals, fiber in some, healthy fat not yet"
    dotsLabel: (often: string[], some: string[], notYet: string[]) => {
      const text = [
        ...often.map(w => `${w.toLowerCase()} in most meals`),
        ...some.map(w => `${w.toLowerCase()} in some`),
        ...notYet.map(w => `${w.toLowerCase()} not yet`),
      ].join(', ');
      return text.charAt(0).toUpperCase() + text.slice(1);
    },
    // "Protein showed up often. Fiber a few times. No healthy fat yet."
    summary: (often: string[], some: string[], notYet: string[]) => {
      const list = (words: string[], joiner: string) => {
        const lower = words.map(w => w.toLowerCase());
        const last = lower.pop()!;
        return lower.length ? `${lower.join(', ')} ${joiner} ${last}` : last;
      };
      const cap = (text: string) =>
        text.charAt(0).toUpperCase() + text.slice(1);
      return [
        often.length ? `${cap(list(often, 'and'))} showed up often.` : null,
        some.length ? `${cap(list(some, 'and'))} a few times.` : null,
        notYet.length ? `No ${list(notYet, 'or')} yet.` : null,
      ]
        .filter(part => part)
        .join(' ');
    },
    noText: 'Add what was in your meals to see the balance.',
  },

  // A meal opened from Your week.
  mealSheet: {
    // "Wednesday, 13:10"
    when: (day: string, time: string) => `${day}, ${time}`,
    close: 'Close',
    delete: 'Delete this meal',
    deleteTitle: 'Delete this meal?',
    deleteMessage: 'It will be gone from your week, photo and all.',
    deleteConfirm: 'Delete',
    deleteFailed: "Couldn't delete the meal",
    saveFailed: "Couldn't save. Try again.",
    edit: 'Edit',
    needsText: 'A meal without a photo needs what was in it.',
  },

  makeToday: {
    link: 'What should I make today?',
    title: 'What should I make?',
    question: 'How much time do you have?',
    times: { 15: '15 min', 30: '30 min', 60: '1 h+' },
    // Under a recipe: what it brings that this week is short on.
    // "Your week has no healthy fat yet. This adds it."
    addsMissing: (nutrient: string) =>
      `Your week has no ${nutrient.toLowerCase()} yet. This adds it.`,
    // "Your week is low on healthy fat. This adds some."
    addsLow: (nutrient: string) =>
      `Your week is low on ${nutrient.toLowerCase()}. This adds some.`,
    noTime: 'No time given',
    empty: (time: string) => `No recipes fit in ${time} yet.`,
    noRecipes: 'No recipes yet. Add one and it shows up here.',
    loadFailed: "Couldn't load your recipes.",
  },

  // The three nutrient dots and the additive balance card (Phase 6). Additive
  // wording: what to add, never what's missing.
  balance: {
    // Read out for a recipe's or meal's dots: "Has protein and fiber, no
    // healthy fat yet".
    hasLabel: (has: string[], not: string[]) => {
      const list = (words: string[], joiner: string) =>
        words.length < 2
          ? words.join('')
          : `${words.slice(0, -1).join(', ')} ${joiner} ${
              words[words.length - 1]
            }`;
      const lower = (words: string[]) => words.map(w => w.toLowerCase());
      if (has.length === 0) return `No ${list(lower(not), 'or')} yet`;
      const hasText = `Has ${list(lower(has), 'and')}`;
      return not.length
        ? `${hasText}, no ${list(lower(not), 'or')} yet`
        : hasText;
    },
    balanced: 'Balanced plate ✓',
    moreFilling: 'Make it more filling',
    add: {
      PROTEIN: 'Add a protein.',
      FIBER: 'Add some fiber.',
      HEALTHY_FAT: 'Add a healthy fat.',
    },
    // Opens the Ingredients list filtered to that nutrient.
    more: {
      PROTEIN: 'See foods with protein ›',
      FIBER: 'See foods with fiber ›',
      HEALTHY_FAT: 'See foods with healthy fat ›',
    },
  },

  ratePrompt: {
    title: (recipeTitle: string) => `How was the ${recipeTitle}?`,
    dismiss: 'Hide this',
    open: (recipeTitle: string) => `Open your ${recipeTitle} attempt`,
    saveFailed: "Couldn't save the rating. Try again.",
  },

  recipeDetail: {
    edit: 'Edit',
    deleteTitle: 'Delete this recipe?',
    deleteMessage: (title: string) => `"${title}" will be gone for good.`,
    // Forks are separate recipes, so deleting the original keeps them.
    deleteKeepsForks: (titles: string[]) =>
      titles.length === 1
        ? `${titles[0]} stays, with its own history.`
        : `${titles.slice(0, -1).join(', ')} and ${
            titles[titles.length - 1]
          } stay, each with its own history.`,
    forkedFrom: (title: string, date: string) => `Based on ${title} · ${date}`,
    source: (source: string) => `From ${source}`,
    openSource: (handle: string) => `Open ${handle} on Instagram`,
    openSourceFailed: "Couldn't open Instagram",
    versionsKicker: 'VERSIONS',
    deleteConfirm: 'Delete',
    deleteFailed: 'Could not delete recipe',
    notFound: 'This recipe no longer exists.',
    prep: 'PREP',
    cook: 'COOK',
    serves: 'SERVES',
    jumpToRecipe: 'Jump to Recipe ↓',
    recipeKicker: 'THE RECIPE',
    startCooking: '▶ Start cooking',
    ingredients: 'Ingredients',
    instructions: 'Instructions',
    deleteRecipe: 'Delete recipe',
    historyKicker: 'HISTORY',
    timesCooked: (count: number) => `${count} time${count === 1 ? '' : 's'}`,
    historyEmpty: "You haven't cooked this yet. Tap Start cooking to begin.",
    historyFailed: "Couldn't load your cooking history.",
    noRating: 'no rating',
    ratingLabel: (stars: number) => `${stars} of 5 stars`,
    changedBadge: 'changed',
  },

  recipeForm: {
    newTitle: 'New recipe',
    editTitle: 'Edit recipe',
    optional: 'Optional',
    titleLabel: 'Title',
    titlePlaceholder: "Grandma's Sunday pancakes",
    sourceLabel: 'From',
    sourcePlaceholder: '@account, Mom, a cookbook…',
    photoLabel: 'Photo link',
    photoPlaceholder: 'https://…',
    storyLabel: 'The story',
    storyHint: 'Optional · blank line between paragraphs',
    storyPlaceholder: 'Where does this recipe come from? Who taught it to you?',
    prepLabel: 'Prep (min)',
    cookLabel: 'Cook (min)',
    servesLabel: 'Serves',
    ingredientsLabel: 'Ingredients',
    ingredientsHint: 'One per line',
    ingredientsPlaceholder: '2 cups flour\n1 cup milk\n2 eggs',
    instructionsLabel: 'Instructions',
    instructionsHint: 'One step per line',
    sectionHint: 'Start a line with # for a section, e.g. # For the cream',
    instructionsPlaceholder:
      'Whisk the dry ingredients.\nAdd the wet ingredients and stir.',
    saveNew: 'Save recipe',
    forkTitle: 'Save as new recipe',
    forkTitlePlaceholder: (title: string) => `${title} — my version`,
    saveChanges: 'Save changes',
    // Filled in from a photo import.
    importBanner: 'Read from your photos. Check the amounts before saving.',
    importProgress: (current: number, total: number) =>
      `Recipe ${current} of ${total}`,
    saveAndNext: 'Save and next',
    skip: 'Skip this one',
    stopImportingTitle: 'Stop importing?',
    stopImportingMessage: "The rest won't be saved.",
    keepGoing: 'Keep going',
    stop: 'Stop',
  },

  import: {
    intro:
      'Photograph a cookbook page, a recipe card or pick screenshots. Up to 5.',
    photoCount: (count: number, max: number) => `Photos · ${count} of ${max}`,
    photoLabel: (position: number, total: number) =>
      `Photo ${position} of ${total}`,
    removePhoto: (position: number) => `Remove photo ${position}`,
    takePhoto: 'Take photo',
    addPhotos: 'Add photos',
    limit: (max: number) => `Up to ${max} photos.`,
    cameraError: "Couldn't open the camera. You can still add photos.",
    getRecipe: 'Get recipe',
    privacyNote:
      'Photos go to Google Gemini to read the recipe and are kept with your import.',
    or: 'or',
    manualLink: 'Type it yourself',
    reading: 'Reading your photos…',
    stillReading: 'Still reading…',
    noRecipe: 'No recipe found in these photos.',
    readFailed: "Couldn't read the photos. They're still here, try again.",
    proError: "Couldn't open Pro. Check your connection and try again.",
  },

  stepper: {
    label: 'Minutes',
    value: (minutes: number) => `${minutes} minute${minutes === 1 ? '' : 's'}`,
  },

  timerDone: {
    needMoreTime: 'Need more time?',
    addTime: (minutes: number) => `Add ${minutes} min`,
    checkStep: 'Check step',
    dismiss: 'Dismiss',
  },

  resumeDraft: {
    title: 'Pick up where you left off?',
    startedAgo: (ago: string) => `You started this ${ago}.`,
    stepsDone: (done: number, total: number) =>
      `${done} of ${total} steps done.`,
    startOver: 'Start over',
    resume: 'Resume',
  },

  attemptDetail: {
    notFound: 'This attempt no longer exists.',
    basedOn: (date: string) => `Based on ${date}`,
    rate: 'Rate',
    notesKicker: 'NOTES',
    noNotes: 'No notes.',
    editNotes: 'Edit notes',
    notesLabel: 'Notes',
    notesPlaceholder: 'How was it? Anything to change next time?',
    saveNotes: 'Save',
    versionKicker: 'THIS VERSION',
    viewFull: 'Full',
    viewChanges: 'Changes',
    cookedAsRecipe: 'Cooked as the recipe',
    ingredients: 'Ingredients',
    steps: 'Steps',
    noChanges: 'No changes',
    cookAgain: 'Cook this version again',
    saveAsRecipe: 'Save as new recipe',
    openRecipe: (title: string) => `Open recipe ${title}`,
    savedAs: (title: string) => `Saved as ${title}`,
    removedLine: (text: string) => `Removed: ${text}`,
    addedLine: (text: string) => `Added: ${text}`,
  },

  finish: {
    title: 'How did it go?',
    took: (date: string, duration: string) => `${date} · took ${duration}`,
    editDuration: 'Correct the cooking time',
    durationLabel: 'Cooking time in minutes',
    durationUnit: 'min',
    recipeSays: (duration: string) => `(recipe says ${duration})`,
    rateLabel: (stars: number) => `${stars} star${stars === 1 ? '' : 's'}`,
    rateLaterHint: 'Not eaten yet? You can rate it later.',
    notesLabel: 'Notes',
    notesPlaceholder: 'What would you change next time?',
    changedIngredients: (count: number) =>
      `${count} ingredient${count === 1 ? '' : 's'}`,
    changedSteps: (count: number) => `${count} step${count === 1 ? '' : 's'}`,
    youChanged: (what: string) => `You changed ${what}.`,
    youChangedBoth: (ingredients: string, steps: string) =>
      `You changed ${ingredients} and ${steps}.`,
    save: 'Save attempt',
    discard: 'Discard',
    discardTitle: 'Discard this attempt?',
    discardMessage: 'Your progress on this phone will be deleted.',
    discardConfirm: 'Discard',
    backToCooking: 'Back to cooking',
  },

  cooking: {
    exit: 'Stop cooking',
    basedOnBanner: (date: string) => `Cooking your ${date} version`,
    finish: 'Finish',
    leaveTitle: 'Stop cooking?',
    leaveMessage: 'Your progress is kept on this phone.',
    keepCooking: 'Keep cooking',
    leave: 'Leave',
    ingredientsHeading: 'INGREDIENTS',
    ingredientsProgress: (used: number, total: number) =>
      `${used} of ${total} used`,
    stepsHeading: 'STEPS',
    stepsProgress: (done: number, total: number) => `${done} of ${total} done`,
    stepLabel: (number: number, text: string) => `Step ${number}: ${text}`,
    addIngredient: '+ Add ingredient',
    addStep: '+ Add step',
    newIngredientPlaceholder: 'New ingredient',
    newStepPlaceholder: 'New step',
    editLine: (text: string) => `Edit "${text}"`,
    save: 'Save',
    remove: 'Remove',
    was: 'was:',
    removed: 'Removed',
    added: 'Added this time',
    elapsed: (time: string) => `Cooking · ${time}`,
    elapsedLabel: (time: string) => `Cooking time ${time}`,
    notesHeading: 'NOTES',
    notesPlaceholder: 'How is it going? Anything to change next time?',
    stepNotePrefix: (number: number) => `Step ${number}: `,
    addStepNote: (number: number) => `Add a note for step ${number}`,
    stepShortLabel: (number: number) => `Step ${number}`,
    stepTimerLabel: (number: number, text: string) =>
      `Step ${number} · ${text}`,
    manualTimerLabel: (number: number) => `Timer ${number}`,
    stepTimerChip: (minutes: number) => `⏱ ${minutes} min`,
    stepTimerRunning: (remaining: string) => `⏱ running ${remaining}`,
    stepTimerPaused: (remaining: string) => `paused ${remaining}`,
    startStepTimer: (number: number, minutes: number) =>
      `Start a ${minutes} minute timer for step ${number}`,
    timerRemaining: (label: string, remaining: string) =>
      `${label}, ${remaining} left`,
    pauseTimer: (label: string) => `Pause ${label}`,
    resumeTimer: (label: string) => `Resume ${label}`,
    removeTimer: (label: string) => `Remove ${label}`,
    addTimer: '+ Timer',
    startTimer: 'Start',
    timerDone: (label: string) => `${label} done`,
    undo: 'undo',
    undoChange: (text: string) => `Undo change to "${text}"`,
  },
};

export type Strings = typeof en;

export const strings: Strings = en;

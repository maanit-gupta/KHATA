// Every user-facing UI string (CLAUDE.md §2, DESIGN.md §9). The UI ships in English this build;
// another language is a new file with the same shape. Two-line headings are [line1, line2].

export const en = {
  brand: 'KHATA',
  arrow: '→',

  nav: {
    ledger: 'Ledger',
    parties: 'Parties',
    scan: 'Scan',
    review: 'Review',
    settings: 'Settings',
    menu: 'Menu',
    close: 'Close',
    main: 'Main',
    reviewCount: (n: number) => `${n} to review`,
  },

  auth: {
    heading: ["Your shop's khata,", 'by voice.'],
    blurb: ["Speak an entry, scan a bill, ask what's owed.", 'Six Indian languages.'],
    sideLabel: 'Six languages, one ledger.',
    email: 'Email',
    password: 'Password',
    name: 'Your name',
    logIn: 'Log in',
    createAccount: 'Create account',
    toSignup: 'New here? Create an account',
    toLogin: 'Have an account? Log in',
    working: 'Working…',
    errors: {
      required: 'This field is required.',
      email: 'Enter an email address like name@example.com.',
      passwordShort: 'Use at least 6 characters.',
      badLogin: 'That email and password don’t match. Check both and try again.',
      exists: 'An account with this email already exists. Log in instead.',
      emailDisabled: 'Email login is turned off for this app. Ask the person who set it up.',
      generic: 'Could not reach the server. Check your internet and try again.',
    },
  },

  onboarding: {
    heading: ['Set up', 'your shop.'],
    languageHeading: ['Pick', 'your language.'],
    step: (n: number) => `Step ${n} of 2`,
    create: 'Create a shop',
    join: 'Join with code',
    shopName: 'Shop name',
    code: '6-character invite code',
    languageHelp: 'Spoken answers and read-backs use this language. You can change it in Settings.',
    next: 'Next',
    back: 'Back',
    createShop: 'Create shop',
    joinShop: 'Join shop',
    errors: {
      required: 'This field is required.',
      codeLength: 'The code has 6 characters.',
      pickLanguage: 'Pick a language to continue.',
    },
  },

  languages: {
    'ta-IN': 'தமிழ்',
    'hi-IN': 'हिन्दी',
    'en-IN': 'English',
    'te-IN': 'తెలుగు',
    'kn-IN': 'ಕನ್ನಡ',
    'ml-IN': 'മലയാളം',
  },

  // Placeholder screens show only their H2 until their step is built.
  screens: {
    ledger: ['Your', 'ledger.'],
    parties: ['Customers', 'and suppliers.'],
    partyDetail: ['Party', 'detail.'],
    review: ['Needs', 'a look.'],
    entry: ['Edit', 'entry.'],
    scan: ['What kind', 'of bill?'],
    settings: ['Your', 'settings.'],
    logOut: 'Log out',
  },

  status: {
    confirmed: 'Confirmed',
    pending: 'Pending',
    voided: 'Voided',
    auto: 'Auto',
    new: 'New',
  },

  ledger: {
    holdToAdd: 'Hold to add',
    listening: 'Listening… release to send',
    working: 'Working…',
    tooShort: 'Hold the button while speaking.',
    micDenied: 'Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.',
    recent: ['Recent', 'entries.'],
    empty: 'No entries yet. Hold the button and say one.',
    confirm: 'Confirm',
    voidIt: 'Void',
    addByHand: 'Add by hand',
    closeForm: 'Close form',
    type: 'Type',
    amount: 'Amount (₹)',
    partyName: 'Customer or supplier name',
    note: 'Note',
    save: 'Save entry',
    saved: (who: string, amount: string) => `Saved · ${who} · ${amount}`,
    heard: (text: string) => `Heard: “${text}”`,
    play: '▶ Play',
    noParty: '—',
  },

  demo: {
    try: 'Try the demo, no account needed',
    banner: 'Demo mode: sample shop, nothing is saved. Voice and bill reading are simulated.',
    exit: 'Exit demo',
  },

  scan: {
    supplier: 'Supplier',
    customer: 'Customer',
    expense: 'Expense',
    paid: 'Paid',
    credit: 'Credit',
    cash: 'Cash',
    udhaar: 'Udhaar',
    photo: 'Photo of the bill (JPG or PNG)',
    reading: 'Reading the bill…',
    typeByHand: 'Type the values from the bill.',
    vendor: 'Vendor',
    date: 'Bill date',
    total: 'Total (₹)',
    customerName: 'Customer name',
    save: 'Save',
    saved: 'Saved.',
    pending: 'Saved as pending. Confirm it on the ledger.',
    another: 'Scan another bill',
  },

  entryTypes: {
    credit_given: 'Credit given',
    payment_received: 'Payment received',
    cash_sale: 'Cash sale',
    purchase_credit: 'Purchase on credit',
    purchase_paid: 'Purchase paid',
    payment_made: 'Payment made',
    expense: 'Expense',
  },

  parties: {
    owesYou: (amount: string) => `Owes you ${amount}`,
    youOwe: (amount: string) => `You owe ${amount}`,
    settled: 'Settled',
    empty: 'No parties yet.',
    back: 'All parties',
  },

  toast: {
    undo: 'Undo',
    undone: 'Undone.',
  },

  errors: {
    loading: 'Loading…',
    notFound: 'That page does not exist.',
  },
} as const

export type Lang = keyof typeof en.languages
export const LANG_ORDER: Lang[] = ['ta-IN', 'hi-IN', 'en-IN', 'te-IN', 'kn-IN', 'ml-IN']

export const t = en

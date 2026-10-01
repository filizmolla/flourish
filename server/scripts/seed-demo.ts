// Fills the separate `flourish_demo` database with data that looks like someone has
// been using the app for months: recipes, cooking attempts with past dates,
// ratings, notes, tweaked versions and recipes edited over time (older attempts
// keep the lines they were cooked with, as the server does) and a few recipes
// saved as new recipes (forks) from one of their attempts, section headings
// (`# ` lines) in a couple of recipes, a "From" source on some, and a few photo
// imports with generated JPEGs under STORAGE_DIR, and three weeks of meals and
// snacks (Phase 6 "Your week") ending today, some with real food photos from
// scripts/demo-photos (Unsplash, see CREDITS.md there) and a "How did you feel
// after?" answer. Most recipes have an Unsplash image URL, and recent attempts a
// photo of what came out (copied to STORAGE_DIR/attempts, like an upload). Run with `npm run seed:demo` (it loads the ingredient catalog
// first, so meal texts and recipe lines match foods as the routes do), view
// with `npm run dev:demo`. Repeatable: demo users are deleted and rebuilt each
// run, and a seeded PRNG keeps the data identical; only the dates move with
// "now" (meals and attempts that would land later today than the run are left out).
//
// Data first (plain arrays you can edit), generation logic below.

// Types and filter constants only; the client itself is imported after the
// database-name check below.
import { Prisma, type Fullness } from "../src/generated/prisma/client.js";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const DEMO_EMAIL_DOMAIN = "@demo.flourish.local";
// Domains earlier runs used, cleaned up too so a rename leaves no old users.
const PREVIOUS_DEMO_EMAIL_DOMAINS: string[] = [];
const demoUserWhere = {
  OR: [DEMO_EMAIL_DOMAIN, ...PREVIOUS_DEMO_EMAIL_DOMAINS].map(domain => ({
    email: { endsWith: domain },
  })),
};
const DEMO_PASSWORD = "demo-password-123";
const PRNG_SEED = 20260926;
// recipe_import.model: the LLM_MODEL in .env.example.
const IMPORT_MODEL = "gemini-3.8-flash";

// When an attempt is cooked: weekday-or-any evening, weekend late morning,
// weekend afternoon, or around noon (a work-from-home lunch).
type Slot = "dinner" | "brunch" | "bake" | "lunch";

// A change to a list of lines (ingredients or steps). Lines are matched by
// exact text; an unknown line stops the script so typos don't slip through.
type Tweak = {
  replace?: [from: string, to: string][];
  insert?: { after: string; line: string }[];
  remove?: string[];
};

type AttemptPlan = {
  daysAgo: number; // 1 = yesterday (always inside the 48 h rate window)
  rating?: number; // omitted = unrated
  notes?: string;
  basedOn?: number; // index of an earlier attempt of the same recipe ("Cook this version again")
  ingredients?: Tweak; // applied on top of the base (recipe or basedOn attempt)
  steps?: Tweak;
  ratedLaterHours?: number; // rated from the card / attempt detail this long after Finish
  fullness?: Fullness; // "How did you feel after?", answered with the rating (so only on rated attempts)
  slot?: Slot; // overrides the recipe's slot for this attempt
  photo?: string; // what came out, taken at Finish: a file in scripts/demo-photos (see CREDITS.md)
};

// A later edit of the recipe's lines in the recipe form. Attempts cooked
// before it keep the old lines as their snapshot (untweaked, no badge).
type RecipeEdit = {
  daysAgo: number;
  ingredients?: Tweak;
  steps?: Tweak;
};

// "Save as new recipe" on one of the original's attempts. The fork starts with
// that attempt's lines as cooked, and copies prep/cook times, servings and the
// image URL from the original; it gets its own title, story and history.
type DemoFork = {
  fromAttempt: number; // index into the original's `attempts`; one fork per attempt
  hoursAfter: number; // saved this long after the attempt's Finish
  title: string;
  story?: string;
  edits?: RecipeEdit[];
  attempts: AttemptPlan[];
};

type DemoRecipe = {
  title: string;
  source?: string; // who it's from ("@handle", "Grandma", a cookbook); most recipes leave it out
  slot: Slot;
  daysAgo: number; // when the recipe was added
  forks?: DemoFork[];
  // A food photo URL pasted in the recipe form (Unsplash, listed in
  // scripts/demo-photos/CREDITS.md). Imported and bare recipes leave it out.
  imageUrl?: string;
  story?: string;
  prepMinutes?: number;
  cookMinutes?: number;
  servings?: number;
  typicalMinutes?: number; // script-only: cooking time for recipes without prep/cook times
  ingredients: string[]; // as first written; `edits` apply on top, in order
  steps: string[]; // stored as `instructions`, one step per line; same as above
  // A line starting with "# " in `ingredients` or `steps` is a section heading.
  edits?: RecipeEdit[]; // the last one sets `updatedAt`
  attempts: AttemptPlan[];
};

// What the model read for one recipe of a photo import: either a recipe that
// was saved from it (its first-version lines, by title) or one that was skipped.
type ParsedSpec =
  | { savedAs: string; title?: string } // title: as the model read it, when the user changed it
  | { title: string; source?: string; ingredients: string[]; steps: string[] };

// Generated stand-ins for the photos (no real content): see `paintPhoto`.
type PhotoKind = "page" | "card" | "screenshot" | "list";

// One "Get recipe" (recipe_import + its import_photo rows and JPEG files).
type DemoImport = {
  status: "DONE" | "NO_RECIPE" | "FAILED";
  daysAgo?: number; // only when nothing was saved; otherwise just before the first saved recipe
  photos: PhotoKind[];
  durationMs: number;
  error?: string; // FAILED only
  parsed?: ParsedSpec[]; // DONE only; every one is reviewed (saved or skipped) and the import closed
};

// A meal or snack logged in the app (Phase 6), not tied to a recipe. `text` is
// what was typed; its nutrients come from the same matcher the route uses, so
// write foods the catalog knows (catalog/foods.ts), separated by commas, "+",
// " and " or " with ". A meal needs a photo, text or both.
type DemoMeal = {
  daysAgo: number; // 0 = today (left out if `at` is still ahead when the script runs)
  at: `${number}:${number}`; // local time, "HH:MM"
  kind?: "SNACK"; // omitted = MEAL
  text?: string;
  photo?: string; // file in scripts/demo-photos
  fullness?: Fullness;
  loggedLaterMinutes?: number; // typed in afterwards (createdAt after eatenAt); default a few minutes
};

type DemoUser = {
  name: string;
  email: string;
  joinedDaysAgo: number;
  recipes: DemoRecipe[];
  imports?: DemoImport[];
  meals?: DemoMeal[];
};

const mainUserRecipes: DemoRecipe[] = [
  {
    title: "Weeknight Chickpea & Spinach Curry",
    imageUrl: "https://images.unsplash.com/photo-1609595781576-1580ff3ee291?w=1200&q=80",
    slot: "dinner",
    daysAgo: 176,
    // The chili flakes from attempt #1 earned a permanent place.
    edits: [{ daysAgo: 150, ingredients: { insert: [{ after: "1 tsp ground cumin", line: "1/2 tsp chili flakes" }] } }],
    story:
      "This started as a clear-out-the-cupboard dinner on a rainy Tuesday and turned into the thing I cook when I can't think of anything else. Two tins, a bag of spinach, twenty-five minutes.\n\nI've made it so often I stopped looking at the recipe, but I keep it here so I remember what the base version was before I started fiddling with it.",
    prepMinutes: 10,
    cookMinutes: 25,
    servings: 4,
    ingredients: [
      "1 tbsp olive oil",
      "1 large onion, finely chopped",
      "3 garlic cloves, grated",
      "1 thumb of ginger, grated",
      "2 tsp curry powder",
      "1 tsp ground cumin",
      "1 can (400 g) chopped tomatoes",
      "1 can (400 ml) coconut milk",
      "2 cans (400 g each) chickpeas, drained",
      "150 g baby spinach",
      "Juice of 1/2 lime",
      "Salt to taste",
      "Cooked rice, to serve",
    ],
    steps: [
      "Heat the oil in a wide pan and cook the onion over medium heat until soft, about 8 minutes.",
      "Add the garlic, ginger, curry powder and cumin and stir for 1 minute until fragrant.",
      "Pour in the tomatoes and coconut milk, add the chickpeas and bring to a gentle boil.",
      "Simmer uncovered for 15 minutes, stirring now and then, until thickened.",
      "Stir in the spinach a handful at a time until wilted.",
      "Finish with lime juice and salt, and serve over rice.",
    ],
    attempts: [
      { daysAgo: 170, rating: 3, notes: "Bit bland. Needs more heat next time." },
      {
        daysAgo: 155,
        rating: 4,
        notes: "Added chili flakes with the spices. Much better.",
        ingredients: { insert: [{ after: "1 tsp ground cumin", line: "1/2 tsp chili flakes" }] },
      },
      { daysAgo: 140, rating: 4, basedOn: 1 },
      {
        daysAgo: 126,
        rating: 5,
        basedOn: 1,
        notes: "Naan instead of rice. Kids asked for seconds.",
        ingredients: { replace: [["Cooked rice, to serve", "Warm naan, to serve"]] },
        steps: {
          replace: [
            [
              "Finish with lime juice and salt, and serve over rice.",
              "Finish with lime juice and salt, and serve with warm naan.",
            ],
          ],
        },
      },
      { daysAgo: 111, rating: 4 },
      { daysAgo: 95, rating: 5, basedOn: 3 },
      { daysAgo: 70, basedOn: 3 },
      {
        daysAgo: 49,
        rating: 4,
        basedOn: 3,
        notes: "Out of spinach, used kale. Fine, but spinach is nicer.",
        ingredients: { replace: [["150 g baby spinach", "150 g kale, stems removed"]] },
        steps: {
          replace: [
            [
              "Stir in the spinach a handful at a time until wilted.",
              "Stir in the kale and cook for 3 minutes until tender.",
            ],
          ],
        },
      },
      { daysAgo: 21, rating: 5, basedOn: 5, notes: "Could make this in my sleep now." },
      { daysAgo: 1, basedOn: 8, photo: "attempt-chickpea-curry.jpg" },
    ],
  },
  {
    title: "Sheet-Pan Lemon Chicken with Potatoes",
    imageUrl: "https://images.unsplash.com/photo-1680098021573-b9402ee336ec?w=1200&q=80",
    slot: "dinner",
    daysAgo: 168,
    story:
      "One tray, one oven, almost no washing up. I first made this the week the dishwasher broke and it has stayed in the rotation ever since.\n\nThe potatoes get a head start so they finish at the same time as the chicken. Don't skip the lemon slices: they go jammy and soft at the edges and are honestly the best bit.",
    prepMinutes: 15,
    cookMinutes: 45,
    servings: 4,
    ingredients: [
      "8 chicken thighs, bone-in, skin-on",
      "800 g baby potatoes, halved",
      "1 lemon, sliced into thin rounds",
      "4 garlic cloves, smashed",
      "3 tbsp olive oil",
      "1 tsp dried oregano",
      "1 tsp smoked paprika",
      "Salt and black pepper",
      "Handful of parsley, chopped",
    ],
    steps: [
      "Heat the oven to 220°C.",
      "Toss the potatoes with half the oil, salt and pepper on a large tray and roast for 15 minutes.",
      "Rub the chicken with the rest of the oil, the oregano, paprika, salt and pepper.",
      "Push the potatoes to the edges and add the chicken skin-side up, with the lemon slices and garlic.",
      "Roast for 30 minutes until the skin is crisp and the juices run clear.",
      "Scatter with parsley and serve straight from the tray.",
    ],
    attempts: [
      { daysAgo: 161, rating: 3, notes: "Potatoes still hard in the middle. Cut them smaller." },
      {
        daysAgo: 146,
        rating: 4,
        notes: "Quartered the potatoes this time, done at the same time as the chicken.",
        ingredients: { replace: [["800 g baby potatoes, halved", "800 g baby potatoes, quartered"]] },
      },
      { daysAgo: 132, rating: 4, basedOn: 1 },
      {
        daysAgo: 104,
        rating: 5,
        basedOn: 1,
        notes: "Added red onion wedges. Keeping that.",
        ingredients: { insert: [{ after: "1 tsp smoked paprika", line: "1 red onion, cut into wedges" }] },
      },
      {
        daysAgo: 80,
        rating: 2,
        basedOn: 3,
        notes: "Forgot to turn the oven back up after the bread. Pale skin, sad dinner.",
      },
      { daysAgo: 58, rating: 5, basedOn: 3 },
      { daysAgo: 31, rating: 5, basedOn: 3 },
      {
        daysAgo: 2,
        rating: 4,
        basedOn: 3,
        notes: "Leftovers for lunch were even better.",
        photo: "attempt-lemon-chicken.jpg",
        ratedLaterHours: 15,
        fullness: "VERY_FULL",
      },
    ],
  },
  {
    title: "Tomato Lentil Soup",
    imageUrl: "https://images.unsplash.com/photo-1611068120813-eca5a8cbf793?w=1200&q=80",
    slot: "dinner",
    daysAgo: 160,
    prepMinutes: 10,
    cookMinutes: 35,
    servings: 6,
    ingredients: [
      "2 tbsp olive oil",
      "1 onion, diced",
      "2 carrots, diced",
      "2 celery sticks, diced",
      "2 garlic cloves, sliced",
      "1 tsp ground cumin",
      "200 g red lentils, rinsed",
      "1 can (400 g) chopped tomatoes",
      "1.2 l vegetable stock",
      "Juice of 1/2 lemon",
      "Salt and pepper",
    ],
    steps: [
      "Soften the onion, carrot and celery in the oil for 10 minutes.",
      "Add the garlic and cumin and cook for 1 minute.",
      "Add the lentils, tomatoes and stock and bring to the boil.",
      "Simmer for 25 minutes until the lentils have collapsed.",
      "Blend half the soup and stir it back in.",
      "Season with lemon juice, salt and pepper.",
    ],
    // Finally wrote the extra stock into the recipe, plus a longer simmer.
    edits: [
      {
        daysAgo: 50,
        ingredients: { replace: [["1.2 l vegetable stock", "1.5 l vegetable stock"]] },
        steps: {
          replace: [
            [
              "Simmer for 25 minutes until the lentils have collapsed.",
              "Simmer for 30 minutes until the lentils have collapsed, adding a splash of water if it gets too thick.",
            ],
          ],
        },
      },
    ],
    attempts: [
      { daysAgo: 150, rating: 4, notes: "Good but very thick. More stock next time." },
      {
        daysAgo: 128,
        rating: 4,
        notes: "Extra stock, right consistency now.",
        ingredients: { replace: [["1.2 l vegetable stock", "1.5 l vegetable stock"]] },
      },
      { daysAgo: 99, rating: 5, basedOn: 1 },
      {
        daysAgo: 35,
        rating: 4,
        notes: "Blender was in the dishwasher, left it chunky. Still good.",
        steps: { remove: ["Blend half the soup and stir it back in."] },
      },
      {
        daysAgo: 8,
        rating: 5,
        fullness: "SATISFIED",
        notes: "Froze four portions. The longer simmer is worth it.",
        photo: "attempt-lentil-soup.jpg",
      },
    ],
  },
  {
    title: "Saturday Shakshuka",
    imageUrl: "https://images.unsplash.com/photo-1542895364-1f38d277f031?w=1200&q=80",
    slot: "brunch",
    daysAgo: 152,
    story:
      "Weekend breakfast at our place means one pan in the middle of the table and everyone tearing bread. The sauce can be made the night before if you want a slower morning.\n\nThe only hard part is the eggs: the whites should be set and the yolks still runny, and there's about a minute between perfect and overdone.",
    prepMinutes: 10,
    cookMinutes: 25,
    servings: 2,
    ingredients: [
      "1 tbsp olive oil",
      "1 onion, sliced",
      "1 red pepper, sliced",
      "2 garlic cloves, chopped",
      "1 tsp ground cumin",
      "1 tsp sweet paprika",
      "1 can (400 g) chopped tomatoes",
      "4 eggs",
      "50 g feta, crumbled",
      "Handful of coriander",
      "Crusty bread, to serve",
    ],
    steps: [
      "Cook the onion and pepper in the oil over medium heat for 10 minutes until soft.",
      "Stir in the garlic, cumin and paprika for 1 minute.",
      "Add the tomatoes and simmer for 8 minutes until slightly thick.",
      "Make four wells, crack in the eggs, cover and cook for 6 minutes until the whites are set.",
      "Scatter over the feta and coriander and serve with bread.",
    ],
    attempts: [
      { daysAgo: 146, rating: 3, notes: "Yolks overcooked. Take the lid off earlier." },
      {
        daysAgo: 125,
        rating: 4,
        notes: "5 min with the lid is right for runny yolks.",
        steps: {
          replace: [
            [
              "Make four wells, crack in the eggs, cover and cook for 6 minutes until the whites are set.",
              "Make four wells, crack in the eggs, cover and cook for 5 minutes until the whites are just set.",
            ],
          ],
        },
      },
      { daysAgo: 104, rating: 5, basedOn: 1, notes: "Made it for guests, all gone." },
      {
        daysAgo: 76,
        rating: 5,
        basedOn: 1,
        notes: "No pepper in the fridge, used a courgette and a bag of spinach. Different dish, just as good.",
        ingredients: {
          replace: [["1 red pepper, sliced", "1 courgette, diced"]],
          insert: [{ after: "1 courgette, diced", line: "100 g baby spinach" }],
        },
        steps: {
          replace: [
            [
              "Cook the onion and pepper in the oil over medium heat for 10 minutes until soft.",
              "Cook the onion and courgette in the oil over medium heat for 8 minutes until soft.",
            ],
          ],
          insert: [
            {
              after: "Stir in the garlic, cumin and paprika for 1 minute.",
              line: "Stir in the spinach a handful at a time until wilted.",
            },
          ],
        },
      },
      {
        daysAgo: 41,
        rating: 5,
        basedOn: 1,
        notes: "Pinch of chili flakes with the spices. Good call.",
        ingredients: { insert: [{ after: "1 tsp sweet paprika", line: "1/2 tsp chili flakes" }] },
      },
      { daysAgo: 14, rating: 4, basedOn: 1, notes: "Pepper went in too late, still crunchy.", photo: "attempt-shakshuka.jpg" },
    ],
    forks: [
      {
        fromAttempt: 3,
        hoursAfter: 3,
        title: "Green Shakshuka",
        story:
          "Born from an empty vegetable drawer. The courgette and spinach version turned out different enough from the tomato-and-pepper one that it deserved its own page.",
        attempts: [
          { daysAgo: 69, rating: 4, notes: "Courgette gave off a lot of water. Cook it a bit longer." },
          {
            daysAgo: 55,
            rating: 5,
            notes: "Ten minutes for the courgette, sauce stayed thick.",
            steps: {
              replace: [
                [
                  "Cook the onion and courgette in the oil over medium heat for 8 minutes until soft.",
                  "Cook the onion and courgette in the oil over medium heat for 10 minutes until soft.",
                ],
              ],
            },
          },
          { daysAgo: 34, rating: 4, basedOn: 1 },
        ],
      },
      {
        fromAttempt: 4,
        hoursAfter: 2,
        title: "Spicy Shakshuka",
        attempts: [
          {
            daysAgo: 27,
            rating: 3,
            notes: "Doubled the chili. Too hot for the kids, fine for me.",
            ingredients: { replace: [["1/2 tsp chili flakes", "1 tsp chili flakes"]] },
          },
          { daysAgo: 20, rating: 5, notes: "Back to half a teaspoon. Everyone happy." },
          {
            daysAgo: 7,
            rating: 5,
            notes: "Spoon of yogurt on top to cool it down. Nice with the heat.",
            photo: "attempt-spicy-shakshuka.jpg",
            ingredients: { insert: [{ after: "Crusty bread, to serve", line: "2 tbsp plain yogurt, to serve" }] },
          },
        ],
      },
    ],
  },
  {
    title: "Banana Walnut Bread",
    imageUrl: "https://images.unsplash.com/photo-1632931057819-4eefffa8e007?w=1200&q=80",
    source: "Grandma",
    slot: "bake",
    daysAgo: 141,
    story:
      "There are always three bananas going brown on our counter, and this is where they end up. It's a one-bowl loaf: no mixer, no creaming, just a fork and a spatula.\n\nIt keeps for days wrapped in a tea towel, and toasted with butter it's a very good breakfast.",
    prepMinutes: 15,
    cookMinutes: 60,
    servings: 10,
    ingredients: [
      "3 very ripe bananas, mashed",
      "80 g butter, melted",
      "100 g brown sugar",
      "1 egg, beaten",
      "1 tsp vanilla extract",
      "1 tsp baking soda",
      "Pinch of salt",
      "190 g plain flour",
      "60 g walnuts, roughly chopped",
    ],
    steps: [
      "Heat the oven to 175°C and line a loaf tin with baking paper.",
      "Mix the mashed bananas with the melted butter.",
      "Stir in the sugar, egg and vanilla.",
      "Sprinkle over the baking soda and salt, then fold in the flour until just combined.",
      "Fold in the walnuts and scrape into the tin.",
      "Bake for 55 minutes, until a skewer comes out clean.",
      "Cool in the tin for 10 minutes, then on a rack.",
    ],
    attempts: [
      { daysAgo: 137, rating: 2, notes: "Sank in the middle. Opened the oven door too early?" },
      { daysAgo: 116, rating: 4, notes: "Kept the door shut this time. Perfect rise." },
      {
        daysAgo: 88,
        rating: 4,
        notes: "Less sugar, bananas were very ripe anyway. Didn't miss it.",
        ingredients: { replace: [["100 g brown sugar", "70 g brown sugar"]] },
      },
      {
        daysAgo: 53,
        rating: 5,
        basedOn: 2,
        notes: "Chocolate chips. Gone in a day.",
        ingredients: {
          insert: [{ after: "60 g walnuts, roughly chopped", line: "50 g dark chocolate chips" }],
        },
        steps: {
          replace: [
            [
              "Fold in the walnuts and scrape into the tin.",
              "Fold in the walnuts and chocolate chips and scrape into the tin.",
            ],
          ],
        },
      },
      {
        daysAgo: 18,
        rating: 4,
        basedOn: 2,
        notes: "Plain one this time for Grandma, she's not a chocolate fan.",
        photo: "attempt-banana-bread.jpg",
      },
    ],
    forks: [
      {
        fromAttempt: 3,
        hoursAfter: 4,
        title: "Chocolate Chip Banana Bread",
        attempts: [
          { daysAgo: 39, rating: 5 },
          { daysAgo: 25, rating: 4, notes: "Chips all sank to the bottom. Toss them in flour first?" },
          {
            daysAgo: 11,
            rating: 5,
            notes: "Tossed the chips in a spoon of flour, they stayed put.",
            photo: "attempt-choc-banana-bread.jpg",
            steps: {
              insert: [
                {
                  after: "Sprinkle over the baking soda and salt, then fold in the flour until just combined.",
                  line: "Toss the chocolate chips in 1 tsp flour.",
                },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    title: "Garlic Butter Green Beans",
    slot: "dinner",
    daysAgo: 131,
    typicalMinutes: 15,
    ingredients: [
      "400 g green beans, trimmed",
      "2 tbsp butter",
      "2 garlic cloves, thinly sliced",
      "Zest of 1/2 lemon",
      "Flaky salt",
    ],
    steps: [
      "Boil the beans in salted water for 4 minutes, then drain.",
      "Melt the butter in the same pan and fry the garlic for 1 minute.",
      "Toss the beans back in with the lemon zest and salt.",
    ],
    attempts: [
      { daysAgo: 129, rating: 4 },
      {
        daysAgo: 30,
        rating: 4,
        notes: "Toasted almonds on top for crunch.",
        ingredients: { insert: [{ after: "Zest of 1/2 lemon", line: "2 tbsp toasted flaked almonds" }] },
      },
    ],
  },
  {
    title: "Beef & Broccoli Stir-Fry",
    imageUrl: "https://images.unsplash.com/photo-1783375175952-705a0600e05c?w=1200&q=80",
    source: "@wokflame.weeknights",
    slot: "dinner",
    daysAgo: 121,
    prepMinutes: 20,
    cookMinutes: 15,
    servings: 3,
    ingredients: [
      "400 g beef sirloin, thinly sliced",
      "1 tbsp cornflour",
      "3 tbsp soy sauce",
      "1 tbsp oyster sauce",
      "1 tsp sesame oil",
      "1 tsp brown sugar",
      "1 head broccoli, cut into small florets",
      "2 garlic cloves, minced",
      "1 thumb of ginger, cut into matchsticks",
      "2 tbsp neutral oil",
      "Cooked rice, to serve",
    ],
    steps: [
      "Toss the beef with the cornflour and 1 tbsp of the soy sauce and leave for 10 minutes.",
      "Mix the rest of the soy sauce with the oyster sauce, sesame oil, sugar and 3 tbsp water.",
      "Steam or blanch the broccoli for 2 minutes.",
      "Heat the oil in a wok until smoking and sear the beef in two batches, 1 minute each, then set aside.",
      "Fry the garlic and ginger for 30 seconds, add the broccoli and sauce and bubble for 1 minute.",
      "Return the beef, toss to coat and serve with rice.",
    ],
    attempts: [
      { daysAgo: 118, rating: 3, notes: "Beef stewed instead of seared. Pan too crowded." },
      { daysAgo: 104, rating: 4, notes: "Two batches as written, much better." },
      {
        daysAgo: 90,
        rating: 2,
        notes: "Grabbed the dark soy by mistake. Way too salty, barely ate it.",
        ingredients: { replace: [["3 tbsp soy sauce", "3 tbsp dark soy sauce"]] },
      },
      { daysAgo: 76, rating: 4 },
      {
        daysAgo: 62,
        rating: 5,
        notes: "Tamari so my gluten-free friend could eat it. Can't tell the difference.",
        ingredients: { replace: [["3 tbsp soy sauce", "3 tbsp tamari"]] },
        steps: {
          replace: [
            [
              "Toss the beef with the cornflour and 1 tbsp of the soy sauce and leave for 10 minutes.",
              "Toss the beef with the cornflour and 1 tbsp of the tamari and leave for 10 minutes.",
            ],
            [
              "Mix the rest of the soy sauce with the oyster sauce, sesame oil, sugar and 3 tbsp water.",
              "Mix the rest of the tamari with the oyster sauce, sesame oil, sugar and 3 tbsp water.",
            ],
          ],
        },
      },
      { daysAgo: 34, rating: 5, basedOn: 4 },
      {
        daysAgo: 11,
        rating: 4,
        fullness: "VERY_FULL",
        basedOn: 4,
        notes: "Threw in a red pepper that needed using. Went back for a second bowl, regretted it a bit.",
        photo: "attempt-beef-broccoli.jpg",
        ingredients: {
          insert: [{ after: "1 head broccoli, cut into small florets", line: "1 red pepper, sliced" }],
        },
        steps: {
          replace: [
            [
              "Fry the garlic and ginger for 30 seconds, add the broccoli and sauce and bubble for 1 minute.",
              "Fry the garlic and ginger for 30 seconds, add the broccoli, pepper and sauce and bubble for 1 minute.",
            ],
          ],
        },
      },
    ],
  },
  {
    title: "Potato Börek",
    imageUrl: "https://images.unsplash.com/photo-1626776065363-7dd3426f92f9?w=1200&q=80",
    source: "Annem",
    slot: "bake",
    daysAgo: 110,
    story:
      "My mum rolls these on Sunday afternoons and the whole flat smells of it by four o'clock. I finally stood next to her with a notebook and wrote down what she does, since she has never measured anything in her life.\n\nShop-bought yufka is fine. The trick is not drowning the sheets in sauce: brush, don't pour.",
    prepMinutes: 40,
    cookMinutes: 40,
    servings: 8,
    ingredients: [
      "# For the filling",
      "4 medium potatoes, boiled and peeled",
      "1 onion, finely chopped",
      "2 tbsp olive oil",
      "1 tsp red pepper flakes",
      "1/2 tsp black pepper",
      "1 tsp salt",
      "Small bunch of parsley, chopped",
      "# For the sauce",
      "2 eggs",
      "200 ml milk",
      "100 ml sunflower oil",
      "# To finish",
      "4 round yufka sheets",
      "1 egg yolk",
      "1 tbsp sesame seeds",
    ],
    steps: [
      "# For the filling",
      "Fry the onion in the oil for 8 minutes until soft.",
      "Mash the potatoes and mix in the onion, pepper flakes, black pepper, salt and parsley.",
      "# For the sauce",
      "Whisk the eggs, milk and oil together.",
      "# To assemble",
      "Heat the oven to 190°C and oil a large round tray.",
      "Lay one yufka sheet flat, brush it all over with sauce and fold it in half.",
      "Spread a quarter of the filling along the straight edge and roll it up into a long snake.",
      "Coil it in the middle of the tray and repeat with the other sheets, joining each roll to the end of the last.",
      "Brush with the egg yolk and scatter with sesame seeds.",
      "Bake for 40 minutes until deep golden.",
      "Rest for 10 minutes before cutting.",
    ],
    attempts: [
      { daysAgo: 104, rating: 3, notes: "Bottom went soggy. Too much sauce on the sheets." },
      {
        daysAgo: 83,
        rating: 4,
        notes: "Less milk in the sauce and a lighter hand with the brush. Crisp all round.",
        ingredients: { replace: [["200 ml milk", "150 ml milk"]] },
      },
      {
        daysAgo: 55,
        rating: 5,
        basedOn: 1,
        notes: "Crumbled feta into the filling. Tastes like Sunday at Annem's.",
        ingredients: { insert: [{ after: "Small bunch of parsley, chopped", line: "100 g feta, crumbled" }] },
        steps: {
          replace: [
            [
              "Mash the potatoes and mix in the onion, pepper flakes, black pepper, salt and parsley.",
              "Mash the potatoes and mix in the onion, feta, pepper flakes, black pepper, salt and parsley.",
            ],
          ],
        },
      },
      {
        daysAgo: 24,
        rating: 5,
        basedOn: 2,
        notes: "Froze half the rolls before baking. 50 min from frozen.",
        photo: "attempt-borek.jpg",
      },
    ],
  },
  {
    title: "Mushroom Barley Risotto",
    imageUrl: "https://images.unsplash.com/photo-1572424075298-e17403e6f3bf?w=1200&q=80",
    slot: "dinner",
    daysAgo: 100,
    story:
      "I wanted risotto without standing over rice, and barley turned out to be more forgiving: it doesn't go gluey if you look away for a minute.\n\nIt's nutty and chewy and even better reheated the next day with a splash of water.",
    prepMinutes: 10,
    cookMinutes: 40,
    servings: 4,
    ingredients: [
      "1 tbsp olive oil",
      "1 tbsp butter",
      "1 onion, finely chopped",
      "250 g chestnut mushrooms, sliced",
      "2 thyme sprigs",
      "200 g pearl barley, rinsed",
      "100 ml white wine",
      "1 l hot vegetable stock",
      "40 g parmesan, grated",
      "Black pepper",
    ],
    steps: [
      "Heat the oil and butter and cook the onion for 5 minutes.",
      "Add the mushrooms and thyme and fry until golden, about 8 minutes.",
      "Stir in the barley, then pour in the wine and let it bubble away.",
      "Add the stock a ladle at a time over 35 minutes, stirring often, until the barley is tender but still chewy.",
      "Take off the heat, beat in the parmesan and season with pepper.",
    ],
    attempts: [
      { daysAgo: 97, rating: 3, notes: "Barley still hard after 35 min. Needed closer to 45." },
      {
        daysAgo: 69,
        rating: 4,
        notes: "Gave it 45 min, right texture.",
        steps: {
          replace: [
            [
              "Add the stock a ladle at a time over 35 minutes, stirring often, until the barley is tender but still chewy.",
              "Add the stock a ladle at a time over 45 minutes, stirring often, until the barley is tender but still chewy.",
            ],
          ],
        },
      },
      { daysAgo: 27, rating: 4, basedOn: 1, photo: "attempt-risotto.jpg" },
    ],
  },
  {
    title: "Crispy Baked Salmon with Herb Yogurt",
    imageUrl: "https://images.unsplash.com/photo-1747097950921-6e273f14b47f?w=1200&q=80",
    slot: "dinner",
    daysAgo: 90,
    prepMinutes: 10,
    cookMinutes: 15,
    servings: 2,
    ingredients: [
      "2 salmon fillets",
      "1 tbsp olive oil",
      "3 tbsp panko breadcrumbs",
      "Zest of 1 lemon",
      "150 g plain yogurt",
      "Small bunch of dill, chopped",
      "1 small garlic clove, grated",
      "Salt and pepper",
    ],
    steps: [
      "Heat the oven to 200°C.",
      "Put the salmon on a lined tray, brush with oil and season.",
      "Mix the panko with the lemon zest and press it on top of the fillets.",
      "Bake for 12 minutes until just flaky.",
      "Stir the dill and garlic into the yogurt with a pinch of salt.",
      "Serve the salmon with a spoonful of herb yogurt.",
    ],
    attempts: [
      { daysAgo: 86, rating: 4, notes: "Quick and good." },
      { daysAgo: 65, rating: 5 },
      {
        daysAgo: 44,
        rating: 3,
        notes: "No dill in the shop, parsley was flat.",
        ingredients: { replace: [["Small bunch of dill, chopped", "Small bunch of parsley, chopped"]] },
        steps: {
          replace: [
            [
              "Stir the dill and garlic into the yogurt with a pinch of salt.",
              "Stir the parsley and garlic into the yogurt with a pinch of salt.",
            ],
          ],
        },
      },
      { daysAgo: 23, rating: 5, ratedLaterHours: 18 },
      {
        daysAgo: 4,
        rating: 4,
        fullness: "STILL_HUNGRY",
        notes: "Two small fillets for two of us. Needed toast after.",
        photo: "attempt-salmon.jpg",
      },
    ],
  },
  {
    title: "Oat & Raisin Cookies",
    imageUrl: "https://images.unsplash.com/photo-1588345274200-42aa29063b78?w=1200&q=80",
    slot: "bake",
    daysAgo: 76,
    prepMinutes: 15,
    cookMinutes: 12,
    servings: 24,
    ingredients: [
      "115 g soft butter",
      "100 g brown sugar",
      "50 g caster sugar",
      "1 egg",
      "1 tsp vanilla extract",
      "120 g plain flour",
      "1/2 tsp baking soda",
      "1 tsp ground cinnamon",
      "150 g rolled oats",
      "100 g raisins",
    ],
    steps: [
      "Heat the oven to 180°C and line two trays.",
      "Beat the butter and both sugars until creamy, then beat in the egg and vanilla.",
      "Stir in the flour, baking soda and cinnamon, then the oats and raisins.",
      "Roll into 24 balls and space them out on the trays.",
      "Bake for 12 minutes until golden at the edges but still soft in the middle.",
      "Leave on the trays for 5 minutes before moving.",
    ],
    attempts: [
      { daysAgo: 72, rating: 3, notes: "Spread into one giant cookie. Chill the dough." },
      {
        daysAgo: 46,
        rating: 5,
        notes: "30 min in the fridge fixed the spreading.",
        steps: {
          insert: [
            {
              after: "Roll into 24 balls and space them out on the trays.",
              line: "Chill the trays in the fridge for 30 minutes.",
            },
          ],
        },
      },
      { daysAgo: 16, rating: 5, basedOn: 1, photo: "attempt-oat-cookies.jpg" },
    ],
  },
  {
    title: "Black Bean Tacos with Quick Pickled Onions",
    imageUrl: "https://images.unsplash.com/photo-1593759608136-45eb2ad9507d?w=1200&q=80",
    source: "@saltypan.notes",
    slot: "dinner",
    daysAgo: 61,
    typicalMinutes: 30,
    ingredients: [
      "1 red onion, thinly sliced",
      "100 ml cider vinegar",
      "1 tsp sugar",
      "1 tsp salt",
      "2 cans (400 g each) black beans, drained",
      "1 tsp ground cumin",
      "1 tsp smoked paprika",
      "1 tbsp olive oil",
      "8 small corn tortillas",
      "1 avocado, sliced",
      "Lime wedges",
    ],
    steps: [
      "Cover the onion with the vinegar, sugar and salt and leave for 20 minutes.",
      "Warm the beans with the oil, cumin and paprika, mashing a few with a fork.",
      "Toast the tortillas in a dry pan.",
      "Fill with beans, avocado and pickled onions, with lime on the side.",
    ],
    attempts: [
      { daysAgo: 57, rating: 4, notes: "The onions are the best part." },
      { daysAgo: 43, rating: 4 },
      {
        daysAgo: 15,
        rating: 5,
        notes: "Feta on top.",
        ingredients: { insert: [{ after: "Lime wedges", line: "50 g feta, crumbled" }] },
      },
      {
        daysAgo: 6,
        rating: 3,
        fullness: "SATISFIED",
        notes: "Tortillas cracked, should have warmed them longer.",
        photo: "attempt-tacos.jpg",
      },
    ],
  },
  {
    title: "Roasted Cauliflower & Tahini Bowl",
    imageUrl: "https://images.unsplash.com/photo-1631311695255-8dde6bf96cb5?w=1200&q=80",
    slot: "dinner",
    daysAgo: 40,
    story:
      "My lunchbox recipe. I roast a big tray on Sunday evening and eat it three days in a row without getting bored, mostly because of the sauce.",
    prepMinutes: 15,
    cookMinutes: 30,
    servings: 2,
    ingredients: [
      "1 cauliflower, cut into florets",
      "1 can (400 g) chickpeas, drained",
      "2 tbsp olive oil",
      "1 tsp ground cumin",
      "1 tsp smoked paprika",
      "150 g cooked quinoa",
      "2 tbsp tahini",
      "Juice of 1 lemon",
      "1 small garlic clove, grated",
      "Handful of parsley",
    ],
    steps: [
      "Heat the oven to 210°C.",
      "Toss the cauliflower and chickpeas with the oil and spices and roast for 30 minutes, turning once.",
      "Whisk the tahini with the lemon juice, garlic and enough water to make it pourable.",
      "Divide the quinoa between bowls, top with the roasted veg and drizzle with the sauce.",
      "Finish with parsley.",
    ],
    attempts: [
      { daysAgo: 37, rating: 3, notes: "Sauce went thick and pasty. Add the water slowly." },
      { daysAgo: 9, rating: 4 },
      {
        daysAgo: 1,
        slot: "lunch",
        rating: 5,
        fullness: "SATISFIED",
        notes: "Home all day, so a fresh one at lunch for once. Threw toasted walnuts on top and it kept me going till dinner.",
        ingredients: { insert: [{ after: "Handful of parsley", line: "Handful of walnuts, toasted and chopped" }] },
        steps: { replace: [["Finish with parsley.", "Finish with parsley and the toasted walnuts."]] },
        photo: "attempt-cauliflower-bowl.jpg",
      },
    ],
  },
  {
    title: "Pumpkin Soup with Ginger",
    imageUrl: "https://images.unsplash.com/photo-1695459003933-4a1b59009355?w=1200&q=80",
    slot: "dinner",
    daysAgo: 20,
    prepMinutes: 15,
    cookMinutes: 30,
    servings: 4,
    ingredients: [
      "1 kg pumpkin, peeled and cubed",
      "1 onion, chopped",
      "1 thumb of ginger, grated",
      "2 tbsp olive oil",
      "800 ml vegetable stock",
      "100 ml coconut milk",
      "Salt and pepper",
      "Toasted pumpkin seeds, to serve",
    ],
    steps: [
      "Cook the onion in the oil for 5 minutes.",
      "Add the ginger and pumpkin and stir for 2 minutes.",
      "Pour in the stock and simmer for 20 minutes until the pumpkin is soft.",
      "Blend until smooth, stir in the coconut milk and season.",
      "Serve topped with pumpkin seeds.",
    ],
    attempts: [
      { daysAgo: 17, rating: 4, notes: "Lovely colour. Could take more ginger." },
      { daysAgo: 3, photo: "attempt-pumpkin-soup.jpg" },
    ],
  },
  {
    title: "Lemon Yogurt Layer Cake",
    source: "@fennel.and.fog.kitchen",
    slot: "bake",
    daysAgo: 20,
    prepMinutes: 30,
    cookMinutes: 25,
    servings: 10,
    ingredients: [
      "# For the cake",
      "250 g plain flour",
      "2 tsp baking powder",
      "1/2 tsp baking soda",
      "Pinch of salt",
      "200 g caster sugar",
      "3 eggs",
      "200 g plain yogurt",
      "120 ml sunflower oil",
      "Zest of 2 lemons",
      "2 tbsp lemon juice",
      "# For the cream",
      "250 g mascarpone",
      "200 ml double cream, cold",
      "60 g icing sugar",
      "Zest of 1 lemon",
      "3 tbsp lemon curd",
      "# To finish",
      "Handful of blueberries",
    ],
    steps: [
      "# For the cake",
      "Heat the oven to 175°C and line two 20 cm round tins.",
      "Whisk the flour, baking powder, baking soda and salt in a bowl.",
      "In another bowl, whisk the sugar, eggs, yogurt, oil, lemon zest and juice until smooth.",
      "Fold the dry ingredients into the wet until just combined and divide between the tins.",
      "Bake for 25 minutes, until a skewer comes out clean.",
      "Cool in the tins for 10 minutes, then on a rack for at least 1 hour.",
      "# For the cream",
      "Beat the mascarpone, cream, icing sugar and lemon zest until it just holds soft peaks, about 2 minutes.",
      "Ripple the lemon curd through with a spatula.",
      "# To assemble",
      "Spread a third of the cream on one cake, top with the second and cover the top with the rest.",
      "Scatter with blueberries and chill for 30 minutes before slicing.",
    ],
    attempts: [
      { daysAgo: 12, rating: 3, notes: "Cream went grainy, I beat it too long. Stop as soon as it holds." },
      {
        daysAgo: 5,
        rating: 5,
        notes: "Birthday cake for my sister. Raspberries instead of blueberries, and less sugar in the cream: the curd is sweet enough.",
        photo: "attempt-birthday-cake.jpg",
        ingredients: {
          replace: [
            ["60 g icing sugar", "40 g icing sugar"],
            ["Handful of blueberries", "Handful of raspberries"],
          ],
        },
        steps: {
          replace: [
            [
              "Scatter with blueberries and chill for 30 minutes before slicing.",
              "Scatter with raspberries and chill for 30 minutes before slicing.",
            ],
          ],
        },
      },
    ],
  },
  {
    title: "Rosemary Focaccia",
    source: "From an old church cookbook",
    slot: "bake",
    daysAgo: 12,
    story:
      "Found this in a spiral-bound fundraiser cookbook at a flea market, photographed the page and saved it to try on a slow weekend. Mostly waiting time, very little work, and apparently the dimpling is the fun part.",
    prepMinutes: 20,
    cookMinutes: 25,
    servings: 8,
    ingredients: [
      "500 g strong white flour",
      "10 g salt",
      "7 g instant yeast",
      "400 ml lukewarm water",
      "5 tbsp olive oil",
      "2 rosemary sprigs",
      "Flaky salt",
    ],
    steps: [
      "Mix the flour, salt, yeast and water into a sticky dough.",
      "Cover and leave to rise for 2 hours, until doubled.",
      "Oil a deep tray with 3 tbsp of the oil and stretch the dough into it.",
      "Leave for 30 minutes more, then dimple all over with oily fingers.",
      "Drizzle with the rest of the oil and scatter with rosemary and flaky salt.",
      "Bake at 220°C for 25 minutes until deep golden.",
    ],
    attempts: [],
  },
  {
    title: "Spiced Red Lentil Dal",
    imageUrl: "https://images.unsplash.com/photo-1736680056444-02b10f16a245?w=1200&q=80",
    slot: "dinner",
    daysAgo: 5,
    ingredients: [
      "200 g red lentils, rinsed",
      "1 tsp ground turmeric",
      "1 l water",
      "2 tbsp neutral oil",
      "1 tsp cumin seeds",
      "1 onion, sliced",
      "2 garlic cloves, sliced",
      "1 green chili, slit",
      "Salt",
      "Handful of coriander",
    ],
    steps: [
      "Simmer the lentils with the turmeric in the water for 25 minutes, stirring now and then.",
      "Meanwhile fry the cumin seeds in the oil for 30 seconds, add the onion and cook for 10 minutes until golden.",
      "Add the garlic and chili for 1 minute.",
      "Pour the onion mixture into the lentils, season and top with coriander.",
    ],
    attempts: [],
  },
];

// Photo imports ("Get recipe"), oldest first. Saved recipes are found by title.
const mainUserImports: DemoImport[] = [
  // A shopping list photographed by mistake: nothing to read.
  { status: "NO_RECIPE", daysAgo: 26, photos: ["list"], durationMs: 6400 },
  // Three pages at once, and the model took too long.
  {
    status: "FAILED",
    daysAgo: 23,
    photos: ["page", "page", "page"],
    durationMs: 60000,
    error: "timeout: No reply within 60000 ms",
  },
  // Two screenshots of a post; the long title was shortened before saving.
  {
    status: "DONE",
    photos: ["screenshot", "screenshot"],
    durationMs: 11800,
    parsed: [{ savedAs: "Lemon Yogurt Layer Cake", title: "Lemon Yogurt Layer Cake with Mascarpone Cream" }],
  },
  // A cookbook page with two recipes: the focaccia was saved, the dip skipped.
  {
    status: "DONE",
    photos: ["page"],
    durationMs: 9300,
    parsed: [
      { savedAs: "Rosemary Focaccia" },
      {
        title: "Whipped Feta Dip",
        source: "From an old church cookbook",
        ingredients: ["200 g feta", "100 g Greek yogurt", "1 tbsp olive oil", "Zest of 1/2 lemon", "Black pepper"],
        steps: [
          "Blend the feta and yogurt until smooth, about 1 minute.",
          "Stir in the lemon zest and pepper and drizzle with the oil.",
        ],
      },
    ],
  },
];

// A second, small account: screens that must show only your own data have
// something to leave out (including an unrated attempt from yesterday).
const secondUserRecipes: DemoRecipe[] = [
  {
    title: "Tuna Pasta Bake",
    slot: "dinner",
    daysAgo: 30,
    prepMinutes: 10,
    cookMinutes: 25,
    servings: 4,
    ingredients: [
      "300 g penne",
      "2 cans (145 g each) tuna, drained",
      "200 g frozen sweetcorn",
      "400 ml passata",
      "100 g cheddar, grated",
    ],
    steps: [
      "Heat the oven to 200°C.",
      "Boil the penne for 8 minutes, then drain.",
      "Mix with the tuna, sweetcorn and passata and tip into a baking dish.",
      "Cover with the cheddar and bake for 15 minutes until bubbling.",
    ],
    attempts: [
      { daysAgo: 25, rating: 4, notes: "Easy. Double the cheese." },
      { daysAgo: 1 },
    ],
  },
  {
    title: "Fried Rice with Peas",
    source: "My flatmate",
    slot: "dinner",
    daysAgo: 10,
    typicalMinutes: 20,
    ingredients: [
      "2 cups cooked rice, cold",
      "2 eggs",
      "150 g frozen peas",
      "2 spring onions, sliced",
      "2 tbsp soy sauce",
      "1 tbsp neutral oil",
    ],
    steps: [
      "Scramble the eggs in the oil and set aside.",
      "Fry the rice and peas over high heat for 5 minutes.",
      "Stir in the eggs, soy sauce and spring onions.",
    ],
    attempts: [{ daysAgo: 7, rating: 3, notes: "Rice was too fresh, went mushy." }],
  },
];

// Meals and snacks logged in the app, newest first: three weeks ending today,
// the current week fullest (Your week in the video). Cooked recipes show up in
// Your week too, from the attempts above (daysAgo 1 and 2 land this week when
// the script runs mid-week). Texts avoid weekday names since the dates move.
const mainUserMeals: DemoMeal[] = [
  // Today
  { daysAgo: 0, at: "07:55", text: "oatmeal with raspberries and blackberries", photo: "oatmeal-berries.jpg", fullness: "SATISFIED" },
  { daysAgo: 0, at: "10:45", kind: "SNACK", text: "banana" },
  { daysAgo: 0, at: "13:10", text: "leftover lemon chicken, rice", fullness: "SATISFIED" },
  { daysAgo: 0, at: "16:20", kind: "SNACK", text: "apple + peanut butter", photo: "apple-peanut-butter.jpg" },
  // Yesterday: breakfast snapped but never typed; the lunch and dinner are cooked recipes.
  { daysAgo: 1, at: "08:30", photo: "egg-avocado-toast.jpg" },
  { daysAgo: 1, at: "16:05", kind: "SNACK", text: "turkey slices + cheddar" },
  // Two days ago: out with the team at lunch.
  { daysAgo: 2, at: "07:40", text: "two boiled eggs, feta, toast", fullness: "STILL_HUNGRY" },
  { daysAgo: 2, at: "10:50", kind: "SNACK", text: "Greek yogurt with berries" },
  {
    daysAgo: 2,
    at: "13:15",
    text: "Team lunch: grilled chicken, black beans, corn and salsa",
    photo: "chicken-black-beans.jpg",
    fullness: "VERY_FULL",
    loggedLaterMinutes: 55,
  },

  // Last week
  { daysAgo: 3, at: "11:20", text: "Brunch out: shakshuka with two eggs, sourdough toast and feta", photo: "shakshuka.jpg", fullness: "VERY_FULL" },
  { daysAgo: 3, at: "16:00", kind: "SNACK", text: "Greek yogurt with berries" },
  { daysAgo: 4, at: "10:30", text: "Greek yogurt, granola, raspberries", photo: "yogurt-granola.jpg", fullness: "SATISFIED" },
  { daysAgo: 4, at: "14:00", text: "hummus, pita, cucumber, olives", photo: "hummus-pita.jpg", fullness: "SATISFIED" },
  // A day trip by train.
  { daysAgo: 5, at: "06:50", text: "banana and a coffee at the station" },
  {
    daysAgo: 5,
    at: "12:40",
    text: "Train lunch: grilled vegetable sandwich with eggplant, zucchini, red pepper and rocket",
    photo: "veg-sandwich.jpg",
    fullness: "STILL_HUNGRY",
  },
  { daysAgo: 5, at: "16:10", kind: "SNACK", text: "almonds" },
  { daysAgo: 5, at: "20:45", text: "Station café on the way home: lentil soup and bread", photo: "lentil-soup.jpg", fullness: "SATISFIED" },
  { daysAgo: 6, at: "13:00", text: "leftover lentil soup from the freezer, whole wheat bread", fullness: "SATISFIED" },
  { daysAgo: 6, at: "16:15", kind: "SNACK", text: "apple + peanut butter" },
  // No time to log during the day: the whole day typed in as one entry at night.
  {
    daysAgo: 7,
    at: "21:40",
    text: "Busy day, all of it: eggs on toast, tuna salad at my desk, pasta with spinach and parmesan",
    fullness: "SATISFIED",
  },
  { daysAgo: 8, at: "08:05", text: "oatmeal with banana and cinnamon" },
  { daysAgo: 8, at: "13:20", text: "rice bowl with white beans, sweet potato and kale", photo: "grain-bowl.jpg", fullness: "SATISFIED" },
  { daysAgo: 9, at: "10:30", kind: "SNACK", text: "Greek yogurt with berries" },
  { daysAgo: 9, at: "13:00", text: "leftover curry and rice" },

  // The week before
  { daysAgo: 10, at: "12:30", text: "pancakes with strawberries and maple syrup", fullness: "VERY_FULL" },
  { daysAgo: 10, at: "19:45", text: "Dinner out: spaghetti with tomato sauce and parmesan", photo: "pasta-tomato.jpg", fullness: "VERY_FULL" },
  { daysAgo: 11, at: "13:00", text: "steak salad with lettuce, cherry tomatoes and pumpkin seeds", photo: "steak-salad.jpg", fullness: "SATISFIED" },
  { daysAgo: 12, at: "13:10", text: "tuna sandwich, apple" },
  { daysAgo: 12, at: "16:00", kind: "SNACK", text: "almonds" },
  { daysAgo: 12, at: "20:30", text: "pizza with mushrooms and olives, side salad", fullness: "VERY_FULL" },
  { daysAgo: 13, at: "10:30", kind: "SNACK", text: "Greek yogurt with berries" },
  { daysAgo: 13, at: "13:00", text: "hummus wrap with chicken and carrots" },
  { daysAgo: 14, at: "12:50", text: "Work lunch: salmon, carrots and mashed potatoes", photo: "salmon-plate.jpg", fullness: "VERY_FULL" },
  { daysAgo: 14, at: "16:30", kind: "SNACK", text: "apple + peanut butter" },
  { daysAgo: 15, at: "16:00", kind: "SNACK", photo: "almonds.jpg" },
  { daysAgo: 16, at: "13:00", text: "leftover shakshuka, bread", fullness: "STILL_HUNGRY" },
  { daysAgo: 16, at: "16:00", kind: "SNACK", text: "banana" },
  { daysAgo: 17, at: "15:00", kind: "SNACK", text: "dates and walnuts" },
  { daysAgo: 18, at: "13:30", text: "falafel wrap with hummus and tomatoes" },
  { daysAgo: 19, at: "20:00", text: "sushi: salmon rolls, edamame", fullness: "SATISFIED" },
  { daysAgo: 20, at: "16:00", kind: "SNACK", text: "Greek yogurt with berries" },
];

// Sam logs a little too, so Your week and Recent snacks have someone else's
// data to leave out.
const secondUserMeals: DemoMeal[] = [
  { daysAgo: 1, at: "08:15", text: "toast with jam" },
  { daysAgo: 2, at: "15:30", kind: "SNACK", text: "crisps" },
];

const demoUsers: DemoUser[] = [
  {
    name: "Mira",
    email: `mira${DEMO_EMAIL_DOMAIN}`,
    joinedDaysAgo: 180,
    recipes: mainUserRecipes,
    imports: mainUserImports,
    meals: mainUserMeals,
  },
  { name: "Sam", email: `sam${DEMO_EMAIL_DOMAIN}`, joinedDaysAgo: 32, recipes: secondUserRecipes, meals: secondUserMeals },
];

// ---------------------------------------------------------------------------
// Logic
// ---------------------------------------------------------------------------

// Safety first: refuse to run against anything but flourish_demo.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run this through `npm run seed:demo`.");
  process.exit(1);
}
const dbName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (dbName !== "flourish_demo") {
  console.error(`Refusing to seed: database is "${dbName}", expected "flourish_demo".`);
  process.exit(1);
}

// Imported only after the check, so nothing connects to another database.
const { prisma } = await import("../src/prisma.js");
const { auth } = await import("../src/auth.js");
const { getStorageDir, readJpegSize } = await import("../src/importPhotos.js");
const { buildMatcher, CATALOG_KEYS_SELECT } = await import("../src/catalog/matcher.js");
const { mealNutrients } = await import("../src/routes/meals.js");

// The catalog must be loaded first (`npm run seed:demo` runs seed-ingredients
// before this script): recipe lines are linked and meal nutrients worked out
// against it, as the routes do.
const catalog = await prisma.ingredient.findMany({ select: CATALOG_KEYS_SELECT });
if (catalog.length === 0) {
  console.error("The ingredient catalog is empty. Run it through `npm run seed:demo`, which loads it first.");
  process.exit(1);
}
const matchLine = buildMatcher(catalog);

const DEMO_PHOTOS_DIR = path.resolve(import.meta.dirname, "demo-photos");

// mulberry32: small deterministic PRNG so every run produces the same data.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(PRNG_SEED);
const randInt = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

const HOUR_MS = 60 * 60 * 1000;
const now = new Date();

// Local calendar day `daysAgo` before today, at the given local time.
function dayAt(daysAgo: number, hour: number, minute: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, randInt(0, 59), 0);
  return d;
}

// Brunch and baking happen at weekends: move to the nearest Saturday/Sunday
// (earlier first), but never to today or later.
function weekendDaysAgo(daysAgo: number): number {
  const weekday = dayAt(daysAgo, 12, 0).getDay(); // 0 = Sun, 6 = Sat
  if (weekday === 0 || weekday === 6) return daysAgo;
  const back = weekday; // days back to the previous Sunday
  const forward = 6 - weekday; // days forward to the next Saturday
  if (back <= forward || daysAgo - forward < 1) return daysAgo + back;
  return daysAgo - forward;
}

function madeAtFor(slot: Slot, daysAgo: number): Date {
  switch (slot) {
    case "dinner":
      return dayAt(daysAgo, randInt(18, 20), randInt(0, 59));
    case "brunch":
      return dayAt(weekendDaysAgo(daysAgo), randInt(9, 11), randInt(0, 59));
    case "bake":
      return dayAt(weekendDaysAgo(daysAgo), randInt(14, 16), randInt(0, 59));
    case "lunch":
      return dayAt(daysAgo, 12, randInt(10, 50));
  }
}

function applyTweak(lines: string[], tweak: Tweak | undefined, where: string): string[] {
  if (!tweak) return lines;
  let result = [...lines];
  const indexOf = (line: string) => {
    const i = result.indexOf(line);
    if (i === -1) throw new Error(`${where}: line not found: "${line}"`);
    return i;
  };
  for (const [from, to] of tweak.replace ?? []) result[indexOf(from)] = to;
  for (const { after, line } of tweak.insert ?? []) result.splice(indexOf(after) + 1, 0, line);
  for (const line of tweak.remove ?? []) result.splice(indexOf(line), 1);
  return result;
}

type RecipeVersion = { at: Date; ingredients: string[]; steps: string[] };

// What `seedRecipe` needs: an original minus its placement, or a fork built
// from its original's attempt.
type RecipeSpec = Omit<DemoRecipe, "daysAgo" | "forks">;
type ForkLink = { forkedFromRecipeId: string; forkedFromAttemptId: string };
// An attempt's lines as actually cooked (its snapshot, or the recipe's lines
// when the snapshot is null), so "Cook this version again" and forks start from them.
type Cooked = { id: string; madeAt: Date; ingredients: string[]; steps: string[] };

type SeededRecipe = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  lines: RecipeVersion; // as first written (what an import read)
  cooked: Cooked[];
};

const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// Active cooking time: close to prep + cook, slower the first couple of times.
function durationFor(recipe: RecipeSpec, attemptIndex: number): number {
  const base = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0) || recipe.typicalMinutes || 30;
  const learning = attemptIndex === 0 ? 1.25 : attemptIndex === 1 ? 1.1 : 1;
  const noise = 0.9 + random() * 0.2;
  return Math.max(5, Math.round(base * learning * noise));
}

// ---------------------------------------------------------------------------
// Photo imports
// ---------------------------------------------------------------------------

// The photos are generated here (flat shapes standing in for a page, a card, a
// post and a list), so no third-party content ends up on disk. Their own PRNG
// keeps the recipe data independent of how the pictures are drawn.
const photoRandom = mulberry32(PRNG_SEED + 1);
const photoInt = (min: number, max: number) => min + Math.floor(photoRandom() * (max - min + 1));

type Gray = { width: number; height: number; pixels: Uint8Array };

function fillRect(img: Gray, x: number, y: number, w: number, h: number, value: number) {
  for (let row = Math.max(0, y); row < Math.min(img.height, y + h); row++) {
    for (let col = Math.max(0, x); col < Math.min(img.width, x + w); col++) {
      img.pixels[row * img.width + col] = value;
    }
  }
}

// A line of "words": dark bars with gaps, up to maxWidth wide.
function textLine(img: Gray, x: number, y: number, maxWidth: number, height: number, value: number) {
  let cursor = x;
  while (cursor + 12 <= x + maxWidth) {
    const word = Math.min(photoInt(12, 58), x + maxWidth - cursor);
    fillRect(img, cursor, y, word, height, value + photoInt(-12, 12));
    cursor += word + photoInt(7, 11);
  }
}

// Width and height are multiples of 8, so the encoder needs no padding.
function paintPhoto(kind: PhotoKind): Gray {
  const [width, height] = kind === "screenshot" ? [432, 936] : kind === "card" ? [640, 480] : [480, 640];
  const img: Gray = { width, height, pixels: new Uint8Array(width * height) };

  // Paper (or screen) with uneven light, like a phone photo.
  const light = photoInt(-10, 10);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const base = kind === "screenshot" ? 246 : 228 + light - Math.round((18 * (row + col)) / (width + height));
      img.pixels[row * width + col] = base + (kind === "screenshot" ? 0 : photoInt(-4, 4));
    }
  }

  switch (kind) {
    case "page": {
      textLine(img, 48, 56, photoInt(180, 300), 18, 40); // title
      let y = 110;
      for (let i = photoInt(6, 10); i > 0; i--, y += 20) textLine(img, 64, y, photoInt(90, 170), 8, 60); // ingredients
      y += 24;
      while (y < height - 60) {
        const last = photoRandom() < 0.2;
        textLine(img, 48, y, last ? photoInt(80, 260) : width - 96, 8, 70); // method paragraphs
        y += last ? 34 : 18;
      }
      break;
    }
    case "card": {
      fillRect(img, 0, 70, width, 2, 170); // red line of an index card, in gray
      for (let y = 110; y < height - 20; y += 32) fillRect(img, 0, y, width, 1, 190);
      textLine(img, 40, 36, photoInt(160, 260), 14, 55);
      for (let y = 92; y < height - 40; y += 32) textLine(img, 40, y, photoInt(200, width - 90), 5, 65);
      break;
    }
    case "screenshot": {
      fillRect(img, 0, 0, width, 40, 30); // status bar
      fillRect(img, 16, 56, 40, 40, 150); // avatar
      textLine(img, 68, 70, photoInt(90, 140), 12, 45); // account name
      // The dish: a plate on a table, as flat shapes.
      const top = 112;
      fillRect(img, 0, top, width, width, 120);
      const cx = width / 2;
      const cy = top + width / 2;
      for (let row = top; row < top + width; row++) {
        for (let col = 0; col < width; col++) {
          const d = Math.hypot(col - cx, row - cy);
          if (d < 170) img.pixels[row * width + col] = d < 120 ? 200 - Math.round(d / 3) : 235;
        }
      }
      let y = top + width + 24;
      while (y < height - 40) {
        textLine(img, 16, y, photoInt(200, width - 32), 9, 50);
        y += 20;
      }
      break;
    }
    case "list": {
      fillRect(img, 120, 0, 240, height, 244); // a narrow note
      for (let y = 60; y < height - 40; y += 34) textLine(img, 144, y, photoInt(50, 150), 7, 50);
      break;
    }
  }
  return img;
}

// Minimal baseline JPEG encoder (grayscale, standard luminance tables), so the
// demo needs no image library. Output is a normal JFIF file.
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47,
  55, 62, 63,
];
const LUMA_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51,
  87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14,
  0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09,
  0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a,
  0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65,
  0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88,
  0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9,
  0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca,
  0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea,
  0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

type HuffCode = { code: number; length: number };

function huffmanCodes(bits: number[], values: number[]): Map<number, HuffCode> {
  const codes = new Map<number, HuffCode>();
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < bits[length - 1]; i++) codes.set(values[k++], { code: code++, length });
    code <<= 1;
  }
  return codes;
}

function encodeJpeg(img: Gray, quality = 80): Buffer {
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  const quant = LUMA_QUANT.map((q) => Math.min(255, Math.max(1, Math.floor((q * scale + 50) / 100))));
  const dcCodes = huffmanCodes(DC_BITS, DC_VALUES);
  const acCodes = huffmanCodes(AC_BITS, AC_VALUES);
  const cos = Array.from({ length: 64 }, (_, i) => Math.cos(((2 * (i >> 3) + 1) * (i & 7) * Math.PI) / 16)); // [x][u]
  const c = (u: number) => (u === 0 ? Math.SQRT1_2 : 1);

  const out: number[] = [];
  const u16 = (n: number) => out.push(n >> 8, n & 0xff);
  // Headers: SOI, JFIF, quantization table, frame, Huffman tables, scan.
  out.push(0xff, 0xd8, 0xff, 0xe0);
  u16(16);
  out.push(0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0);
  out.push(0xff, 0xdb);
  u16(67);
  out.push(0, ...ZIGZAG.map((i) => quant[i]));
  out.push(0xff, 0xc0);
  u16(11);
  out.push(8);
  u16(img.height);
  u16(img.width);
  out.push(1, 1, 0x11, 0);
  out.push(0xff, 0xc4);
  u16(2 + 17 + DC_VALUES.length + 17 + AC_VALUES.length);
  out.push(0x00, ...DC_BITS, ...DC_VALUES, 0x10, ...AC_BITS, ...AC_VALUES);
  out.push(0xff, 0xda);
  u16(8);
  out.push(1, 1, 0x00, 0, 63, 0);

  // Entropy-coded data, with 0xFF bytes stuffed.
  let buffer = 0;
  let bufferBits = 0;
  const writeBits = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) {
      buffer = (buffer << 1) | ((value >> i) & 1);
      if (++bufferBits === 8) {
        out.push(buffer);
        if (buffer === 0xff) out.push(0);
        buffer = 0;
        bufferBits = 0;
      }
    }
  };
  const category = (v: number) => (v === 0 ? 0 : Math.floor(Math.log2(Math.abs(v))) + 1);
  const writeValue = (v: number, size: number) => writeBits(v < 0 ? v + (1 << size) - 1 : v, size);
  const writeCode = (codes: Map<number, HuffCode>, symbol: number) => {
    const { code, length } = codes.get(symbol)!;
    writeBits(code, length);
  };

  const block = new Float64Array(64);
  const rows = new Float64Array(64);
  const coefficients = new Int32Array(64);
  let previousDc = 0;
  for (let by = 0; by < img.height; by += 8) {
    for (let bx = 0; bx < img.width; bx += 8) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) block[y * 8 + x] = img.pixels[(by + y) * img.width + bx + x] - 128;
      }
      // Separable 2D DCT: along each row, then down each column.
      for (let y = 0; y < 8; y++) {
        for (let u = 0; u < 8; u++) {
          let sum = 0;
          for (let x = 0; x < 8; x++) sum += block[y * 8 + x] * cos[x * 8 + u];
          rows[y * 8 + u] = sum * c(u) * 0.5;
        }
      }
      for (let u = 0; u < 8; u++) {
        for (let v = 0; v < 8; v++) {
          let sum = 0;
          for (let y = 0; y < 8; y++) sum += rows[y * 8 + u] * cos[y * 8 + v];
          const index = v * 8 + u;
          coefficients[index] = Math.round((sum * c(v) * 0.5) / quant[index]);
        }
      }

      const dc = coefficients[0];
      const diff = dc - previousDc;
      previousDc = dc;
      const dcSize = category(diff);
      writeCode(dcCodes, dcSize);
      writeValue(diff, dcSize);

      let run = 0;
      for (let k = 1; k < 64; k++) {
        const value = coefficients[ZIGZAG[k]];
        if (value === 0) {
          run++;
          continue;
        }
        while (run > 15) {
          writeCode(acCodes, 0xf0);
          run -= 16;
        }
        const size = category(value);
        writeCode(acCodes, (run << 4) | size);
        writeValue(value, size);
        run = 0;
      }
      if (run > 0) writeCode(acCodes, 0x00);
    }
  }
  if (bufferBits > 0) writeBits(0x7f, 8 - bufferBits); // pad with 1s
  out.push(0xff, 0xd9);
  return Buffer.from(out);
}

// One "Get recipe": the import row, its photos (files and rows), and the
// links from the recipes that were saved from it.
async function seedImport(
  userId: string,
  plan: DemoImport,
  where: string,
  seededByTitle: Map<string, SeededRecipe>,
) {
  const parsed = plan.parsed ?? [];
  if ((plan.status === "DONE") !== parsed.length > 0) throw new Error(`${where}: DONE needs parsed recipes, others none`);
  if ((plan.status === "FAILED") !== (plan.error !== undefined)) throw new Error(`${where}: error is for FAILED only`);

  const saved = parsed.flatMap((spec, index) => {
    if (!("savedAs" in spec)) return [];
    const recipe = seededByTitle.get(spec.savedAs);
    if (!recipe) throw new Error(`${where}: no recipe titled "${spec.savedAs}"`);
    return [{ index, recipe }];
  });

  // Saved recipes are created a few minutes after the model's reply; the
  // queue is closed when the last one is saved, or a minute later on a skip.
  let createdAt: Date;
  let closedAt: Date;
  if (saved.length > 0) {
    if (plan.daysAgo !== undefined) throw new Error(`${where}: daysAgo follows the first saved recipe`);
    createdAt = new Date(saved[0].recipe.createdAt.getTime() - plan.durationMs - randInt(3, 7) * 60_000);
    const lastSaved = saved.at(-1)!;
    const skippedAfter = lastSaved.index < parsed.length - 1;
    closedAt = new Date(lastSaved.recipe.createdAt.getTime() + (skippedAfter ? 60_000 : 0));
  } else {
    if (plan.daysAgo === undefined) throw new Error(`${where}: needs daysAgo`);
    createdAt = dayAt(plan.daysAgo, randInt(18, 21), randInt(0, 59));
    closedAt = new Date(createdAt.getTime() + plan.durationMs);
  }
  if (closedAt >= now) throw new Error(`${where}: in the future`);

  // { recipes: [{ title, source, ingredients, steps }] }, as the model returned it.
  const recipes = parsed.map((spec) => {
    if (!("savedAs" in spec)) return { ...spec, source: spec.source ?? "" };
    const recipe = seededByTitle.get(spec.savedAs)!;
    const demo = demoUsers.flatMap((u) => u.recipes).find((r) => r.title === spec.savedAs)!;
    return {
      title: spec.title ?? spec.savedAs,
      source: demo.source ?? "",
      ingredients: recipe.lines.ingredients,
      steps: recipe.lines.steps,
    };
  });

  const recipeImport = await prisma.recipeImport.create({
    data: {
      userId,
      status: plan.status,
      photoCount: plan.photos.length,
      model: IMPORT_MODEL,
      durationMs: plan.durationMs,
      error: plan.error ?? null,
      result: plan.status === "FAILED" ? Prisma.DbNull : { recipes },
      reviewedCount: parsed.length,
      closedAt,
      createdAt,
      updatedAt: closedAt,
    },
  });

  if (storageDir) {
    const folder = path.posix.join("imports", userId, recipeImport.id);
    await mkdir(path.join(storageDir, folder), { recursive: true });
    const rows = [];
    for (const [position, kind] of plan.photos.entries()) {
      const data = encodeJpeg(paintPhoto(kind));
      const size = readJpegSize(data);
      if (!size) throw new Error(`${where}: generated photo is not a readable JPEG`);
      const relativePath = path.posix.join(folder, `${position}.jpg`);
      await writeFile(path.join(storageDir, relativePath), data);
      rows.push({
        importId: recipeImport.id,
        position,
        path: relativePath,
        mimeType: "image/jpeg",
        bytes: data.length,
        ...size,
        createdAt,
      });
    }
    await prisma.importPhoto.createMany({ data: rows });
  }

  // Link the saved recipes, keeping their own updatedAt.
  for (const { index, recipe } of saved) {
    await prisma.recipe.update({
      where: { id: recipe.id },
      data: { importId: recipeImport.id, importIndex: index, updatedAt: recipe.updatedAt },
    });
  }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

// Remove previous demo users; recipes, attempts, imports and meals cascade.
// Their import, meal and attempt photo folders don't, so they go first.
const storageDir = getStorageDir();
const previousUsers = await prisma.user.findMany({
  where: demoUserWhere,
  select: { id: true },
});
if (storageDir) {
  for (const { id } of previousUsers) {
    await rm(path.join(storageDir, "imports", id), { recursive: true, force: true });
    await rm(path.join(storageDir, "meals", id), { recursive: true, force: true });
    await rm(path.join(storageDir, "attempts", id), { recursive: true, force: true });
  }
}

// One logged meal or snack, as POST /meals stores it: the row with the
// nutrients its text brings, then the photo copied to
// STORAGE_DIR/meals/{userId}/{mealId}.jpg and its path on the row. Returns
// false when the meal would be later today than now (left out).
async function seedMeal(userId: string, plan: DemoMeal, where: string): Promise<boolean> {
  const [hour, minute] = plan.at.split(":").map(Number);
  if (!(hour >= 0 && hour < 24 && minute >= 0 && minute < 60)) throw new Error(`${where}: bad time "${plan.at}"`);
  const eatenAt = new Date(now);
  eatenAt.setDate(eatenAt.getDate() - plan.daysAgo);
  eatenAt.setHours(hour, minute, 0, 0);
  if (eatenAt >= now) {
    if (plan.daysAgo > 0) throw new Error(`${where}: in the future`);
    return false;
  }

  const text = plan.text?.trim() || null;
  if (!text && !plan.photo) throw new Error(`${where}: a meal needs a photo or text`);
  if (text && text.length > 500) throw new Error(`${where}: text is over 500 characters`);

  // Logged a few minutes after eating, or later when set; never after now.
  const loggedAt = new Date(
    Math.min(eatenAt.getTime() + (plan.loggedLaterMinutes ?? 4) * 60_000, now.getTime() - 60_000),
  );
  const meal = await prisma.meal.create({
    data: {
      userId,
      kind: plan.kind ?? "MEAL",
      eatenAt,
      text,
      nutrients: await mealNutrients(text),
      fullness: plan.fullness ?? null,
      createdAt: loggedAt,
      updatedAt: loggedAt,
    },
  });

  if (plan.photo) {
    const photoPath = await copyDemoPhoto("meals", userId, meal.id, plan.photo, where);
    await prisma.meal.update({ where: { id: meal.id }, data: { photoPath, updatedAt: loggedAt } });
  }
  return true;
}

// Copies a file from scripts/demo-photos to STORAGE_DIR/{folder}/{userId}/{id}.jpg,
// as the meal and attempt routes store an upload, and returns the stored path.
async function copyDemoPhoto(
  folder: "meals" | "attempts",
  userId: string,
  id: string,
  file: string,
  where: string,
): Promise<string> {
  if (!storageDir) throw new Error(`STORAGE_DIR must be set (in .env.demo) to keep ${folder} photos`);
  const source = path.join(DEMO_PHOTOS_DIR, file);
  const size = readJpegSize(await readFileChecked(source, where));
  if (!size) throw new Error(`${where}: ${file} is not a JPEG`);
  // Forward slashes so the stored path is the same on Windows and Linux.
  const photoPath = path.posix.join(folder, userId, `${id}.jpg`);
  await mkdir(path.join(storageDir, folder, userId), { recursive: true });
  await copyFile(source, path.join(storageDir, photoPath));
  return photoPath;
}

async function readFileChecked(file: string, where: string): Promise<Buffer> {
  try {
    return await readFile(file);
  } catch {
    throw new Error(`${where}: photo not found: ${file}`);
  }
}
const removed = await prisma.user.deleteMany({ where: demoUserWhere });
console.log(`Removed ${removed.count} previous demo user(s).`);

// Creates one recipe (an original, or a fork when `fork` is given) with its
// edits and attempts; returns its id and the attempts' lines as cooked.
async function seedRecipe(
  userId: string,
  recipe: RecipeSpec,
  createdAt: Date,
  fork?: ForkLink,
): Promise<SeededRecipe> {
  if (createdAt >= now) throw new Error(`${recipe.title}: added in the future`);

  // Every version of the recipe's lines, oldest first; the last is today's.
  const versions: RecipeVersion[] = [{ at: createdAt, ingredients: recipe.ingredients, steps: recipe.steps }];
  for (const [i, edit] of (recipe.edits ?? []).entries()) {
    const where = `${recipe.title} edit #${i}`;
    const previous = versions.at(-1)!;
    const at = dayAt(edit.daysAgo, 21, randInt(0, 59));
    if (at <= previous.at || at >= now) throw new Error(`${where}: must be after the previous version and in the past`);
    const ingredients = applyTweak(previous.ingredients, edit.ingredients, where);
    const steps = applyTweak(previous.steps, edit.steps, where);
    if (sameLines(ingredients, previous.ingredients) && sameLines(steps, previous.steps)) {
      throw new Error(`${where}: changes nothing`);
    }
    versions.push({ at, ingredients, steps });
  }
  const today = versions.at(-1)!;
  const updatedAt = today.at;

  const created = await prisma.recipe.create({
    data: {
      title: recipe.title,
      source: recipe.source ?? null,
      story: recipe.story ?? null,
      prepMinutes: recipe.prepMinutes ?? null,
      cookMinutes: recipe.cookMinutes ?? null,
      servings: recipe.servings ?? null,
      ingredients: today.ingredients,
      // Phase 5: the lines table; recipe.ingredients stays in sync until it's dropped.
      // Linked to the catalog on save, as the recipe routes do (headings never are).
      lines: {
        create: today.ingredients.map((text, position) => ({ position, text, ingredientId: matchLine(text) })),
      },
      instructions: today.steps.join("\n"),
      imageUrl: recipe.imageUrl ?? null,
      userId,
      forkedFromRecipeId: fork?.forkedFromRecipeId ?? null,
      forkedFromAttemptId: fork?.forkedFromAttemptId ?? null,
      createdAt,
      updatedAt,
    },
  });

  const cooked: Cooked[] = [];

  for (const [i, plan] of recipe.attempts.entries()) {
    const where = `${recipe.title} attempt #${i}`;
    const base = plan.basedOn === undefined ? undefined : cooked[plan.basedOn];
    if (plan.basedOn !== undefined && !base) throw new Error(`${where}: basedOn must be an earlier attempt`);

    const madeAt = madeAtFor(plan.slot ?? recipe.slot, plan.daysAgo);
    // The recipe as it read when cooking started.
    const current = versions.filter((v) => v.at <= madeAt).at(-1)!;

    const ingredients = applyTweak(base?.ingredients ?? current.ingredients, plan.ingredients, where);
    const steps = applyTweak(base?.steps ?? current.steps, plan.steps, where);

    // What the app sends at Finish: a field's full list only when it differs
    // from the recipe at that moment. Sending any of them marks it tweaked.
    const sentIngredients = !sameLines(ingredients, current.ingredients);
    const sentSteps = !sameLines(steps, current.steps);
    // A later recipe edit writes the old lines into the null snapshots
    // (honest history), per field, without touching `tweaked`.
    const later = versions.filter((v) => v.at > madeAt);
    const backfilledIngredients = later.some((v) => !sameLines(v.ingredients, current.ingredients));
    const backfilledSteps = later.some((v) => !sameLines(v.steps, current.steps));

    if (madeAt <= createdAt) throw new Error(`${where}: cooked before the recipe was added`);
    if (madeAt >= now) throw new Error(`${where}: cooked in the future`);
    if (base && madeAt <= base.madeAt) throw new Error(`${where}: cooked before the attempt it's based on`);
    const previous = cooked.at(-1);
    if (previous && madeAt <= previous.madeAt) throw new Error(`${where}: out of order`);

    const rating = plan.rating ?? null;
    if (rating !== null && (rating < 1 || rating > 5)) throw new Error(`${where}: rating must be 1–5`);
    if (plan.fullness && rating === null) throw new Error(`${where}: fullness is answered with the rating`);
    const ratedAt = plan.ratedLaterHours
      ? new Date(Math.min(madeAt.getTime() + plan.ratedLaterHours * HOUR_MS, now.getTime() - HOUR_MS))
      : madeAt;

    const attempt = await prisma.attempt.create({
      data: {
        recipeId: created.id,
        madeAt,
        durationMinutes: durationFor(recipe, i),
        rating,
        fullness: plan.fullness ?? null,
        notes: plan.notes ?? null,
        // null = same as today's recipe; otherwise the full list as cooked.
        ingredients:
          sentIngredients || backfilledIngredients ? ingredients.map((text) => ({ text })) : Prisma.DbNull,
        instructions: sentSteps || backfilledSteps ? steps.join("\n") : null,
        tweaked: sentIngredients || sentSteps,
        basedOnAttemptId: base?.id ?? null,
        createdAt: madeAt,
        updatedAt: ratedAt,
      },
    });
    // The photo is sent with Finish: the row first, then the file named after it.
    if (plan.photo) {
      const photoPath = await copyDemoPhoto("attempts", userId, attempt.id, plan.photo, where);
      await prisma.attempt.update({ where: { id: attempt.id }, data: { photoPath, updatedAt: ratedAt } });
    }
    cooked.push({ id: attempt.id, madeAt, ingredients, steps });
  }
  return { id: created.id, createdAt, updatedAt, lines: versions[0], cooked };
}

for (const demoUser of demoUsers) {
  const { user } = await auth.api.signUpEmail({
    body: { email: demoUser.email, password: DEMO_PASSWORD, name: demoUser.name },
  });
  const joinedAt = dayAt(demoUser.joinedDaysAgo, 20, 15);
  await prisma.user.update({ where: { id: user.id }, data: { createdAt: joinedAt, updatedAt: joinedAt } });

  const seededByTitle = new Map<string, SeededRecipe>();
  for (const { daysAgo, forks, ...recipe } of demoUser.recipes) {
    const createdAt = dayAt(daysAgo, randInt(20, 22), randInt(0, 59));
    const original = await seedRecipe(user.id, recipe, createdAt);
    seededByTitle.set(recipe.title, original);

    // "Save as new recipe": the fork starts from the attempt's lines as cooked
    // and copies prep/cook times, servings and image from the original.
    const forkedAttempts = new Set<number>();
    for (const fork of forks ?? []) {
      const where = `${recipe.title} fork "${fork.title}"`;
      const from = original.cooked[fork.fromAttempt];
      if (!from) throw new Error(`${where}: fromAttempt must be one of the original's attempts`);
      if (forkedAttempts.has(fork.fromAttempt)) throw new Error(`${where}: that attempt already has a fork`);
      forkedAttempts.add(fork.fromAttempt);
      const forkCreatedAt = new Date(from.madeAt.getTime() + fork.hoursAfter * HOUR_MS);
      await seedRecipe(
        user.id,
        {
          title: fork.title,
          source: recipe.source, // the fork form keeps the original's source
          slot: recipe.slot,
          story: fork.story,
          prepMinutes: recipe.prepMinutes,
          cookMinutes: recipe.cookMinutes,
          servings: recipe.servings,
          imageUrl: recipe.imageUrl, // the fork form keeps the original's image
          typicalMinutes: recipe.typicalMinutes,
          ingredients: from.ingredients,
          steps: from.steps,
          edits: fork.edits,
          attempts: fork.attempts,
        },
        forkCreatedAt,
        { forkedFromRecipeId: original.id, forkedFromAttemptId: from.id },
      );
    }
  }

  for (const [i, demoImport] of (demoUser.imports ?? []).entries()) {
    await seedImport(user.id, demoImport, `${demoUser.email} import #${i}`, seededByTitle);
  }

  let laterToday = 0;
  for (const [i, meal] of (demoUser.meals ?? []).entries()) {
    if (!(await seedMeal(user.id, meal, `${demoUser.email} meal #${i}`))) laterToday++;
  }
  if (laterToday > 0) console.log(`${demoUser.email}: ${laterToday} meal(s) later today than now left out.`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const windowStart = new Date(now.getTime() - 48 * HOUR_MS);
// The current week as the app asks for it: Monday 00:00 local to next Monday.
const weekStart = new Date(now);
weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
weekStart.setHours(0, 0, 0, 0);
const weekEnd = new Date(weekStart);
weekEnd.setDate(weekEnd.getDate() + 7);
const fmt = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "-");

console.log("\nDemo data summary");
for (const demoUser of demoUsers) {
  const owned = { recipe: { user: { email: demoUser.email } } };
  const hasSnapshot = { OR: [{ ingredients: { not: Prisma.AnyNull } }, { instructions: { not: null } }] };
  const [
    recipes,
    neverCooked,
    edited,
    attempts,
    range,
    ratings,
    unratedRecent,
    unratedOlder,
    snapshots,
    tweaked,
    snapshotNotTweaked,
    basedOn,
    ratedLater,
  ] = await Promise.all([
      prisma.recipe.count({ where: { user: { email: demoUser.email } } }),
      prisma.recipe.count({ where: { user: { email: demoUser.email }, attempts: { none: {} } } }),
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM recipe r JOIN "user" u ON u.id = r."userId"
        WHERE u.email = ${demoUser.email} AND r."updatedAt" > r."createdAt"`,
      prisma.attempt.count({ where: owned }),
      prisma.attempt.aggregate({ where: owned, _min: { madeAt: true }, _max: { madeAt: true } }),
      prisma.attempt.groupBy({ by: ["rating"], where: owned, _count: { _all: true }, orderBy: { rating: "asc" } }),
      prisma.attempt.count({ where: { ...owned, rating: null, madeAt: { gte: windowStart } } }),
      prisma.attempt.count({ where: { ...owned, rating: null, madeAt: { lt: windowStart } } }),
      prisma.attempt.count({ where: { ...owned, ...hasSnapshot } }),
      prisma.attempt.count({ where: { ...owned, tweaked: true } }),
      prisma.attempt.count({ where: { ...owned, tweaked: false, ...hasSnapshot } }),
      prisma.attempt.count({ where: { ...owned, basedOnAttemptId: { not: null } } }),
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM attempt a JOIN recipe r ON r.id = a."recipeId" JOIN "user" u ON u.id = r."userId"
        WHERE u.email = ${demoUser.email} AND a."updatedAt" > a."madeAt"`,
    ]);
  const spread = ratings.map((r) => `${r.rating === null ? "unrated" : `${r.rating}★`}: ${r._count._all}`).join(", ");
  console.log(`\n${demoUser.email}`);
  console.log(`  recipes: ${recipes} (${neverCooked} never cooked, ${Number(edited[0]?.n ?? 0)} edited later)`);
  console.log(`  attempts: ${attempts}, ${fmt(range._min.madeAt)} → ${fmt(range._max.madeAt)}`);
  console.log(`  ratings: ${spread}`);
  console.log(`  unrated in last 48 h: ${unratedRecent}, unrated older: ${unratedOlder}`);
  console.log(
    `  with snapshot: ${snapshots}, tweaked ("changed" badge): ${tweaked}, snapshot but not tweaked: ${snapshotNotTweaked}`,
  );
  console.log(`  based on an earlier attempt: ${basedOn}`);

  const [withImage, attemptPhotos] = await Promise.all([
    prisma.recipe.count({ where: { user: { email: demoUser.email }, imageUrl: { not: null } } }),
    prisma.attempt.findMany({ where: { ...owned, photoPath: { not: null } }, select: { madeAt: true, photoPath: true } }),
  ]);
  let missingAttemptPhotos = 0;
  for (const { photoPath } of attemptPhotos) {
    if (!storageDir || !(await stat(path.join(storageDir, photoPath!)).catch(() => null))) missingAttemptPhotos++;
  }
  const photosThisWeek = attemptPhotos.filter((a) => a.madeAt >= weekStart && a.madeAt < weekEnd).length;
  console.log(`  recipes with an image URL: ${withImage} of ${recipes}`);
  console.log(
    `  attempts with a photo: ${attemptPhotos.length} (${photosThisWeek} this week)` +
      (missingAttemptPhotos ? `, ${missingAttemptPhotos} FILE(S) MISSING` : ""),
  );
  console.log(`  rated later (updatedAt after madeAt): ${Number(ratedLater[0]?.n ?? 0)}`);

  const forks = await prisma.recipe.findMany({
    where: { user: { email: demoUser.email }, forkedFromRecipeId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      title: true,
      createdAt: true,
      forkedFromRecipe: { select: { title: true } },
      forkedFromAttempt: { select: { madeAt: true } },
      _count: { select: { attempts: true } },
    },
  });
  console.log(`  forks ("Save as new recipe"): ${forks.length}`);
  for (const f of forks) {
    console.log(
      `    ${f.title} ← ${f.forkedFromRecipe?.title} (attempt ${fmt(f.forkedFromAttempt?.madeAt)}), ` +
        `saved ${fmt(f.createdAt)}, ${f._count.attempts} attempt(s)`,
    );
  }

  const [sources, withHeadings, headingSnapshots, imports, photos, importedRecipes] = await Promise.all([
    prisma.recipe.findMany({
      where: { user: { email: demoUser.email }, source: { not: null } },
      select: { source: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM recipe r JOIN "user" u ON u.id = r."userId"
      WHERE u.email = ${demoUser.email}
        AND (r.instructions ~ '(^|\n)# ' OR EXISTS (SELECT 1 FROM unnest(r.ingredients) l WHERE l LIKE '# %'))`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM attempt a JOIN recipe r ON r.id = a."recipeId" JOIN "user" u ON u.id = r."userId"
      WHERE u.email = ${demoUser.email} AND (a.instructions ~ '(^|\n)# ' OR a.ingredients::text LIKE '%"# %')`,
    prisma.recipeImport.groupBy({
      by: ["status"],
      where: { user: { email: demoUser.email } },
      _count: { _all: true },
      orderBy: { status: "asc" },
    }),
    prisma.importPhoto.aggregate({ where: { import: { user: { email: demoUser.email } } }, _count: true, _sum: { bytes: true } }),
    prisma.recipe.count({ where: { user: { email: demoUser.email }, importId: { not: null } } }),
  ]);
  console.log(`  with a source: ${sources.length} (${sources.map((r) => r.source).join(", ") || "-"})`);
  console.log(
    `  with section headings: ${Number(withHeadings[0]?.n ?? 0)} recipe(s), ` +
      `${Number(headingSnapshots[0]?.n ?? 0)} attempt snapshot(s)`,
  );
  const importSpread = imports.map((r) => `${r.status}: ${r._count._all}`).join(", ") || "none";
  console.log(
    `  photo imports: ${importSpread}; ${photos._count} photo(s), ${Math.round((photos._sum.bytes ?? 0) / 1024)} KB; ` +
      `${importedRecipes} recipe(s) saved from one`,
  );

  // Phase 6: meals, fullness and the current week as GET /week returns it.
  const mine = { user: { email: demoUser.email } };
  const [meals, mealRange, attemptFullness, weekMeals, weekAttempts, recent] = await Promise.all([
    prisma.meal.findMany({ where: mine, select: { kind: true, text: true, photoPath: true, fullness: true } }),
    prisma.meal.aggregate({ where: mine, _min: { eatenAt: true }, _max: { eatenAt: true } }),
    prisma.attempt.groupBy({
      by: ["fullness"],
      where: { ...owned, fullness: { not: null } },
      _count: { _all: true },
      orderBy: { fullness: "asc" },
    }),
    prisma.meal.findMany({
      where: { ...mine, eatenAt: { gte: weekStart, lt: weekEnd } },
      select: { eatenAt: true, kind: true, text: true, nutrients: true, photoPath: true, fullness: true },
      orderBy: { eatenAt: "asc" },
    }),
    prisma.attempt.findMany({
      where: { ...owned, madeAt: { gte: weekStart, lt: weekEnd } },
      select: {
        madeAt: true,
        fullness: true,
        recipe: { select: { title: true, lines: { select: { ingredient: { select: { nutrients: true } } } } } },
      },
    }),
    prisma.meal.findMany({
      where: { ...mine, kind: "SNACK", text: { not: null } },
      select: { text: true },
      orderBy: { eatenAt: "desc" },
    }),
  ]);
  const count = (keep: (m: (typeof meals)[number]) => boolean) => meals.filter(keep).length;
  const photoFiles = meals.flatMap((m) => (m.photoPath ? [m.photoPath] : []));
  let onDisk = 0;
  for (const file of photoFiles) {
    if (storageDir && (await stat(path.join(storageDir, file)).catch(() => null))?.isFile()) onDisk++;
  }
  console.log(
    `  meals: ${meals.length} (${count((m) => m.kind === "SNACK")} snacks), ${fmt(mealRange._min.eatenAt)} → ${fmt(mealRange._max.eatenAt)}; ` +
      `photo+text ${count((m) => !!m.photoPath && !!m.text)}, text only ${count((m) => !m.photoPath)}, ` +
      `photo only ${count((m) => !!m.photoPath && !m.text)}; with fullness ${count((m) => m.fullness !== null)}`,
  );
  console.log(`  meal photos on disk: ${onDisk} of ${photoFiles.length}`);
  console.log(
    `  attempts with fullness: ${attemptFullness.map((r) => `${r.fullness}: ${r._count._all}`).join(", ") || "none"}`,
  );
  const recentSnacks = [...new Map(recent.map((r) => [r.text!.toLowerCase(), r.text!])).values()].slice(0, 8);
  console.log(`  recent snacks: ${recentSnacks.join(" | ") || "-"}`);

  // The week's triangle input: meals by their stored nutrients, attempts by
  // their recipe's linked lines today (as GET /week does).
  const tally = new Map<string, number>();
  const days = new Set<string>();
  for (const m of weekMeals) {
    days.add(m.eatenAt.toDateString());
    for (const n of m.nutrients) tally.set(n, (tally.get(n) ?? 0) + 1);
  }
  for (const a of weekAttempts) {
    days.add(a.madeAt.toDateString());
    const present = new Set(a.recipe.lines.flatMap((l) => l.ingredient?.nutrients ?? []));
    for (const n of present) tally.set(n, (tally.get(n) ?? 0) + 1);
  }
  console.log(
    `  this week (from ${weekStart.toLocaleDateString("en-CA")} local → now): ${weekMeals.length} meals (${weekMeals.filter((m) => m.photoPath).length} with a photo), ` +
      `${weekAttempts.length} cooked (${weekAttempts.map((a) => `${a.recipe.title}${a.fullness ? ` [${a.fullness}]` : ""}`).join("; ") || "-"}), ` +
      `${days.size} day(s) with something`,
  );
  console.log(
    `  this week's nutrients (entries that bring each): ` +
      (["PROTEIN", "FIBER", "HEALTHY_FAT"].map((n) => `${n} ${tally.get(n) ?? 0}`).join(", ")),
  );
  for (const m of weekMeals) {
    const time = m.eatenAt.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
    console.log(
      `    ${time} ${m.kind === "SNACK" ? "snack" : "meal "} ${m.photoPath ? "[photo]" : "       "} ` +
        `${m.text ?? "(no text)"} → ${m.nutrients.join(", ") || "-"}${m.fullness ? ` [${m.fullness}]` : ""}`,
    );
  }
}

// One recipe with sections and a source, as stored.
const sample = await prisma.recipe.findFirst({
  where: { title: "Lemon Yogurt Layer Cake", user: { email: { endsWith: DEMO_EMAIL_DOMAIN } } },
  select: { title: true, source: true, ingredients: true, instructions: true, importIndex: true, import: { select: { status: true } } },
});
if (sample) {
  console.log(`\nSample: ${sample.title} (source: ${sample.source}, imported: ${sample.import?.status ?? "no"})`);
  console.log(sample.ingredients.map((line) => `  | ${line}`).join("\n"));
  console.log("  ---");
  console.log(sample.instructions.split("\n").map((line) => `  | ${line}`).join("\n"));
}

console.log("\nLog in with (all demo users share one password):");
for (const demoUser of demoUsers) console.log(`  ${demoUser.email} / ${DEMO_PASSWORD}`);
console.log("View it: in server/, run `npm run dev:demo` instead of `npm run dev`, then log in to the app.");

await prisma.$disconnect();
process.exit(0);

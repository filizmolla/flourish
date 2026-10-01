// Sample recipes for local development and E2E runs. Stories are deliberately
// long and rambling, in the style of recipe blogs that tell you about their
// grandmother's kitchen before getting to the ingredients.

export type SeedRecipe = {
  title: string;
  story: string;
  imageUrl: string;
  prepMinutes: number;
  cookMinutes: number;
  servings: number;
  ingredients: string[];
  instructions: string;
  // How many days before "now" the recipe was posted, so the list has a spread of dates.
  daysAgo: number;
};

const unsplash = (id: string) => `https://images.unsplash.com/photo-${id}?w=1200&q=80&auto=format&fit=crop`;

export const seedRecipes: SeedRecipe[] = [
  {
    title: "Grandma's Sunday Morning Yogurt Pancakes",
    story:
      "Every Sunday of my childhood started the same way: the hiss of butter hitting a cast-iron pan and my grandmother humming something off-key while she flipped pancakes with a spatula older than my mother. She never measured anything. \"A handful of this, a splash of that,\" she'd say, which is lovely until you try to recreate it thirty years later with nothing but a vague memory and a kitchen scale.\n\nIt took me the better part of a year (and, honestly, a few tearful batches) to get these right. I swapped in Greek yogurt for some of the buttermilk because it keeps me full until lunch, and I think she would have approved — she always said breakfast should \"stick to your ribs.\"\n\nThese are fluffy, a little tangy, and perfect with a drizzle of honey and whatever fruit is sitting on your counter. Make a double batch. You'll thank me on Tuesday.",
    imageUrl: unsplash("1567620905732-2d1ec7ab7445"),
    prepMinutes: 10,
    cookMinutes: 20,
    servings: 4,
    ingredients: [
      "1 1/2 cups all-purpose flour",
      "1 cup plain Greek yogurt",
      "3/4 cup milk",
      "2 large eggs",
      "2 tbsp melted butter, plus more for the pan",
      "1 tbsp honey",
      "2 tsp baking powder",
      "1/2 tsp baking soda",
      "1/4 tsp salt",
      "Sliced banana and honey, to serve",
    ],
    instructions:
      "Whisk the flour, baking powder, baking soda and salt in a large bowl.\nIn a second bowl, whisk the yogurt, milk, eggs, melted butter and honey until smooth.\nPour the wet ingredients into the dry and fold gently — a few lumps are fine.\nLet the batter rest for 5 minutes while you heat a buttered skillet over medium heat.\nPour 1/4 cup of batter per pancake and cook until bubbles form on top, about 2 minutes. Flip and cook 1 minute more.\nServe stacked high with banana and a drizzle of honey.",
    daysAgo: 1,
  },
  {
    title: "Backyard Adana-Style Kebab Platter",
    story:
      "There is a specific smell that means summer to me, and it is charcoal smoke drifting over a garden fence while someone's uncle insists he knows exactly how hot the grill is (he does not). Our family gatherings always ended up around a long table crowded with kebabs, charred peppers, and far too many bowls of yogurt sauce.\n\nI used to think proper Adana kebab needed a special wide skewer and a lifetime of practice. The lifetime of practice part is true, but you can get surprisingly close at home with a regular grill pan and some patience. The trick is chilling the meat mixture so it clings to the skewer.\n\nPile everything onto one big board, put it in the middle of the table, and let everyone help themselves. No plates required, in my opinion.",
    imageUrl: unsplash("1555939594-58d7cb561ad1"),
    prepMinutes: 30,
    cookMinutes: 15,
    servings: 6,
    ingredients: [
      "1 kg ground lamb (or half lamb, half beef)",
      "1 red bell pepper, very finely chopped",
      "1 small onion, grated and squeezed dry",
      "2 tsp pul biber (Aleppo pepper)",
      "1 tsp ground cumin",
      "1 1/2 tsp salt",
      "4 long green peppers",
      "2 tomatoes, halved",
      "1 cup plain yogurt with 1 grated garlic clove",
      "Flatbreads, to serve",
    ],
    instructions:
      "Knead the meat, bell pepper, onion, pul biber, cumin and salt together for 5 minutes until sticky.\nCover and chill for at least 1 hour.\nWith wet hands, press the mixture onto wide skewers in long, flat sausages.\nGrill over high heat, turning once, for 8–10 minutes until charred outside and just cooked through.\nGrill the green peppers and tomatoes alongside until blistered.\nServe on a big board with flatbreads and the garlicky yogurt.",
    daysAgo: 4,
  },
  {
    title: "Crispy Salmon Rainbow Bowl",
    story:
      "I'll be honest with you: this bowl was born out of a fridge clean-out. It was a Thursday, I was tired, and I had one salmon fillet, half a cucumber, and a sad-looking bag of corn in the freezer. Twenty minutes later I was sitting on the kitchen floor (the chairs were covered in laundry, don't judge) eating the best thing I'd made all week.\n\nThe secret is getting the salmon skin properly crispy — dry it with paper towels like you mean it and don't touch it once it hits the pan. Everything else is just color. The more colors, the better you'll feel about your life choices.\n\nThis has become my go-to 'I need to eat something that isn't toast' dinner, and it's a great one to prep ahead for lunches.",
    imageUrl: unsplash("1546069901-ba9599a7e63c"),
    prepMinutes: 15,
    cookMinutes: 12,
    servings: 2,
    ingredients: [
      "2 skin-on salmon fillets",
      "1 cup cooked brown rice",
      "1 cup shredded red cabbage",
      "1 cucumber, diced",
      "1 cup sweetcorn",
      "1 avocado, sliced",
      "2 soft-boiled eggs",
      "1 tbsp olive oil",
      "2 tbsp soy sauce",
      "1 tsp sesame oil",
      "1 tsp rice vinegar",
    ],
    instructions:
      "Pat the salmon very dry and season with salt.\nHeat olive oil in a skillet over medium-high heat and cook the salmon skin-side down for 6 minutes without moving it.\nFlip and cook 2–3 minutes more, then break into chunks.\nWhisk soy sauce, sesame oil and rice vinegar together.\nDivide rice between bowls and arrange cabbage, cucumber, corn, avocado and eggs around it.\nTop with salmon and drizzle over the dressing.",
    daysAgo: 7,
  },
  {
    title: "Jammy Egg & Avocado Toast",
    story:
      "I know, I know. Avocado toast. Every food blog on the internet has one, and here I am adding to the pile. But hear me out, because this is less of a recipe and more of a small morning ritual I'd like to convince you to adopt.\n\nA few years ago I went through a stretch of skipping breakfast entirely, grabbing a coffee and running out the door. By 11am I was a hangry mess. My best friend — a nutritionist, and very patient with me — suggested I try pairing protein, fiber and healthy fat at every meal. This toast was my first real attempt, and I've made it probably four hundred times since.\n\nThe 6½-minute egg is non-negotiable. Set a timer. Trust the timer.",
    imageUrl: unsplash("1482049016688-2d3e1b311543"),
    prepMinutes: 5,
    cookMinutes: 7,
    servings: 1,
    ingredients: [
      "2 slices sourdough bread",
      "1 ripe avocado",
      "2 large eggs",
      "1 handful baby spinach",
      "1/2 lemon, juiced",
      "Flaky salt and cracked black pepper",
      "Chili flakes (optional)",
    ],
    instructions:
      "Bring a small pot of water to a boil. Lower in the eggs and cook for exactly 6 1/2 minutes.\nTransfer the eggs to ice water for 2 minutes, then peel.\nToast the bread.\nMash the avocado with lemon juice and a pinch of salt.\nSpread the avocado on the toast, add spinach, and top with halved eggs.\nFinish with flaky salt, pepper and chili flakes.",
    daysAgo: 11,
  },
  {
    title: "Weeknight Chicken Tikka Masala",
    story:
      "The first time I tried to make tikka masala, I used a jar of sauce, burned the rice, and set off the smoke alarm so thoroughly that my neighbor knocked to check on me. Not my finest hour. That was about eight years ago, and I've been quietly working on redemption ever since.\n\nThis version is the one I actually make on busy weeknights. It skips the overnight marinade (though if you have time, do it — it's even better) and comes together in one pan. The sauce is rich and creamy but lighter than the takeout version, thanks to a mix of yogurt and just a little cream.\n\nMy partner requests this roughly every three days. I have stopped counting.",
    imageUrl: unsplash("1588166524941-3bf61a9c41db"),
    prepMinutes: 15,
    cookMinutes: 30,
    servings: 4,
    ingredients: [
      "600 g boneless chicken thighs, cubed",
      "1/2 cup plain yogurt",
      "2 tbsp garam masala, divided",
      "1 tsp turmeric",
      "1 onion, finely diced",
      "3 garlic cloves, minced",
      "1 tbsp grated ginger",
      "1 can (400 g) crushed tomatoes",
      "1/3 cup heavy cream",
      "2 tbsp ghee or oil",
      "Fresh cilantro and basmati rice, to serve",
    ],
    instructions:
      "Toss the chicken with yogurt, 1 tbsp garam masala, turmeric and a pinch of salt.\nHeat ghee in a large pan and brown the chicken in batches. Set aside.\nIn the same pan, soften the onion for 5 minutes, then add garlic, ginger and the remaining garam masala.\nPour in the tomatoes and simmer for 10 minutes.\nStir in the cream and return the chicken to the pan. Simmer 10 minutes more.\nServe over rice with lots of cilantro.",
    daysAgo: 15,
  },
  {
    title: "Summer Pesto Farfalle Salad",
    story:
      "Every July, my tiny balcony basil plant goes absolutely feral. I don't know what I do differently in summer — maybe it's the one month I remember to water it — but suddenly I have more basil than any reasonable person could use. This pasta salad is my annual answer.\n\nIt's the dish I bring to every picnic, potluck and 'just come over, I'll make something' evening. It travels well, it tastes even better the next day, and it's the kind of thing people ask for the recipe for, which, as a food blogger, is basically my love language.\n\nIf you don't have a feral basil plant, store-bought pesto is completely fine. I won't tell anyone.",
    imageUrl: unsplash("1473093295043-cdd812d0e601"),
    prepMinutes: 15,
    cookMinutes: 12,
    servings: 6,
    ingredients: [
      "400 g farfalle",
      "2 cups fresh basil leaves",
      "1/3 cup pine nuts, toasted",
      "1/2 cup grated parmesan",
      "1 garlic clove",
      "1/2 cup extra-virgin olive oil",
      "250 g cherry tomatoes, halved",
      "2 cups arugula",
      "1 cup white beans, drained",
      "Salt and lemon juice, to taste",
    ],
    instructions:
      "Cook the farfalle in well-salted water until al dente. Drain and rinse under cold water.\nBlend basil, pine nuts, parmesan, garlic and olive oil into a pesto. Season with salt and lemon.\nToss the pasta with the pesto until coated.\nFold in the tomatoes, white beans and arugula.\nChill for 30 minutes before serving, or pack up for a picnic.",
    daysAgo: 20,
  },
  {
    title: "Lemony Mushroom Risotto",
    story:
      "Risotto has a reputation for being fussy, and I'm here to tell you that reputation is only about forty percent deserved. Yes, you have to stir. No, you don't have to stand there for an hour whispering encouragement to the rice.\n\nI learned to make risotto during a very rainy autumn when I'd just moved to a new city, didn't know anyone, and had a lot of evenings to fill. There's something meditative about it — a glass of wine, a podcast, a wooden spoon, and the slow magic of rice turning creamy.\n\nThe lemon at the end is what makes this one sing. It cuts through all that butter and parmesan and makes the whole thing taste bright instead of heavy. Don't skip it.",
    imageUrl: unsplash("1476124369491-e7addf5db371"),
    prepMinutes: 10,
    cookMinutes: 35,
    servings: 4,
    ingredients: [
      "1 1/2 cups arborio rice",
      "300 g mixed mushrooms, sliced",
      "1 shallot, finely diced",
      "2 garlic cloves, minced",
      "1/2 cup dry white wine",
      "5 cups warm vegetable stock",
      "1/2 cup grated parmesan",
      "2 tbsp butter",
      "1 tbsp olive oil",
      "1 lemon, zested and juiced",
      "Fresh thyme",
    ],
    instructions:
      "Sauté the mushrooms in olive oil until golden. Set aside.\nIn the same pan, melt 1 tbsp butter and soften the shallot and garlic.\nAdd the rice and toast for 1 minute, then pour in the wine and stir until absorbed.\nAdd stock one ladle at a time, stirring often, until the rice is creamy and just tender, about 20 minutes.\nStir in the mushrooms, parmesan, remaining butter, lemon zest and juice.\nRest 2 minutes, then serve topped with thyme.",
    daysAgo: 26,
  },
  {
    title: "Blueberry Banana French Toast",
    story:
      "My sister and I have a long-running argument about the correct bread for French toast. She is team brioche. I am team 'whatever is slightly stale in the bread box.' We have been having this argument since approximately 2004 and neither of us has budged an inch.\n\nThis recipe is my peace offering. It works beautifully with brioche (hi, sis), but it's also forgiving enough for day-old sourdough or challah. The custard has a little cinnamon and vanilla, and I pile on blueberries and banana because fruit counts as a vegetable at brunch. That's the rule.\n\nMake this for someone you love. Or make it for yourself on a slow Saturday — you deserve it too.",
    imageUrl: unsplash("1484723091739-30a097e8f929"),
    prepMinutes: 10,
    cookMinutes: 15,
    servings: 4,
    ingredients: [
      "8 thick slices brioche or day-old bread",
      "4 large eggs",
      "1 cup milk",
      "1 tsp vanilla extract",
      "1 tsp ground cinnamon",
      "2 tbsp butter",
      "1 cup blueberries",
      "2 bananas, sliced",
      "Maple syrup and powdered sugar, to serve",
    ],
    instructions:
      "Whisk the eggs, milk, vanilla and cinnamon in a shallow dish.\nMelt butter in a large skillet over medium heat.\nDip each slice of bread in the custard for a few seconds per side.\nCook until golden, 2–3 minutes per side.\nStack on plates and top with blueberries, banana, maple syrup and a dusting of powdered sugar.",
    daysAgo: 33,
  },
  {
    title: "Lemon Quinoa & Green Bean Bowl",
    story:
      "This is what I make when I've eaten nothing but pastries for three days straight and my body is politely asking for a vegetable. It's bright, crunchy, and — I promise — not sad at all, which is the highest compliment I can give a grain bowl.\n\nI first had something like it at a tiny café on a trip to the coast, sitting outside in a wind so strong it kept blowing my napkin into the sea. I went back three days in a row and tried to reverse-engineer it in my notebook. My notes say 'lemon?? beans?? something crunchy??' which, as it turns out, was about right.\n\nIt keeps for days in the fridge, so I make a big batch on Sunday and feel very organized for approximately one week.",
    imageUrl: unsplash("1547592180-85f173990554"),
    prepMinutes: 10,
    cookMinutes: 20,
    servings: 3,
    ingredients: [
      "1 cup quinoa, rinsed",
      "250 g green beans, trimmed",
      "1 cup cherry tomatoes, halved",
      "1 can chickpeas, drained",
      "1/4 cup toasted sunflower seeds",
      "3 tbsp olive oil",
      "1 lemon, zested and juiced",
      "1 tsp Dijon mustard",
      "Fresh herbs (parsley, dill)",
    ],
    instructions:
      "Cook the quinoa in 2 cups salted water for 15 minutes, then fluff and let cool slightly.\nBlanch the green beans in boiling water for 3 minutes and plunge into ice water.\nWhisk olive oil, lemon zest and juice, and Dijon with salt and pepper.\nToss the quinoa, green beans, tomatoes and chickpeas with the dressing.\nTop with sunflower seeds and fresh herbs.",
    daysAgo: 41,
  },
  {
    title: "Creamy Tuscan Steak Tagliatelle",
    story:
      "Some recipes are for Tuesdays. This one is for anniversaries, promotions, and the kind of Friday where you've survived something and want to celebrate by eating very well on the couch.\n\nI made it for the first time for my parents' 30th anniversary. I was nervous — cooking steak for my dad is a high-stakes activity, he has Opinions — but he went back for seconds and then asked, very casually, if there was any left for lunch tomorrow. In our family, that's basically a standing ovation.\n\nSun-dried tomatoes, spinach and a garlicky parmesan cream sauce wrap around every ribbon of pasta. The steak goes on top, sliced thin. Light a candle. Open the good wine.",
    imageUrl: unsplash("1551183053-bf91a1d81141"),
    prepMinutes: 15,
    cookMinutes: 25,
    servings: 4,
    ingredients: [
      "400 g tagliatelle",
      "2 sirloin steaks (about 500 g total)",
      "1/2 cup sun-dried tomatoes, sliced",
      "3 cups baby spinach",
      "4 garlic cloves, minced",
      "1 cup heavy cream",
      "3/4 cup grated parmesan",
      "1 tsp Italian seasoning",
      "2 tbsp olive oil",
      "Salt and pepper",
    ],
    instructions:
      "Season the steaks generously and sear in olive oil over high heat, 3–4 minutes per side. Rest for 10 minutes, then slice thinly.\nCook the tagliatelle until al dente, reserving 1 cup of pasta water.\nIn the steak pan, sauté the garlic and sun-dried tomatoes for 1 minute.\nAdd cream, parmesan and Italian seasoning and simmer until slightly thickened.\nStir in the spinach until wilted, then toss in the pasta, loosening with pasta water.\nServe topped with the sliced steak.",
    daysAgo: 52,
  },
  {
    title: "Slow Sunday Penne Bolognese",
    story:
      "My uncle Marco — not actually my uncle, and not actually Italian, but he'll tell you otherwise — taught me that bolognese is a lesson in patience. \"You can't rush a sauce,\" he'd say, lifting the lid for the fortieth time to stir it with the gravity of a surgeon.\n\nThis is my long, slow Sunday version. It bubbles away for a couple of hours while you do laundry, read a book, or take a very long nap. The house will smell incredible. Your neighbors may become suspiciously friendly.\n\nI add a handful of red lentils, which isn't traditional at all, but it makes the sauce thicker, heartier, and stretches it to feed a crowd. Uncle Marco has forgiven me. Mostly.",
    imageUrl: unsplash("1621996346565-e3dbc646d9a9"),
    prepMinutes: 20,
    cookMinutes: 120,
    servings: 6,
    ingredients: [
      "500 g penne",
      "500 g ground beef",
      "1/2 cup red lentils, rinsed",
      "1 onion, 1 carrot and 1 celery stalk, finely diced",
      "3 garlic cloves, minced",
      "2 tbsp tomato paste",
      "1 can (800 g) crushed tomatoes",
      "1/2 cup red wine",
      "1/2 cup milk",
      "2 tbsp olive oil",
      "Parmesan, to serve",
    ],
    instructions:
      "Heat olive oil in a heavy pot and soften the onion, carrot and celery for 10 minutes.\nAdd the garlic and beef and cook until browned.\nStir in the tomato paste, then deglaze with red wine.\nAdd the tomatoes, lentils, milk and 1 cup water. Season with salt and pepper.\nSimmer on the lowest heat, partly covered, for 2 hours, stirring occasionally.\nToss with cooked penne and serve with lots of parmesan.",
    daysAgo: 64,
  },
  {
    title: "Raspberry Cream Layer Cake",
    story:
      "Every family has a birthday cake. Ours was a slightly lopsided raspberry sponge that my mother made every single year, for every single person, no matter what they actually asked for. My brother requested chocolate for eleven consecutive years. He got raspberry every time.\n\nWhen I started baking seriously, I set out to make a version that was a little more polished — straighter layers, a lighter cream, fresh raspberries crowning the top. It took me more attempts than I'm willing to admit publicly, including one memorable incident where an entire cake slid off the plate on the way to the table.\n\nThis is the cake I'm proudest of. It looks fancy, but it's really just sponge, cream and berries. My brother, for the record, now requests it.",
    imageUrl: unsplash("1565958011703-44f9829ba187"),
    prepMinutes: 40,
    cookMinutes: 25,
    servings: 10,
    ingredients: [
      "4 large eggs, room temperature",
      "3/4 cup sugar",
      "1 cup all-purpose flour",
      "1 tsp baking powder",
      "3 tbsp melted butter",
      "2 cups heavy cream, cold",
      "1 cup mascarpone",
      "1/4 cup powdered sugar",
      "400 g fresh raspberries",
      "3 tbsp raspberry jam",
    ],
    instructions:
      "Heat the oven to 180°C and line two 20 cm cake tins.\nBeat the eggs and sugar for 8 minutes until pale and tripled in volume.\nSift in the flour and baking powder and fold gently, then fold in the melted butter.\nDivide between the tins and bake 20–25 minutes. Cool completely.\nWhip the cream, mascarpone and powdered sugar to soft peaks.\nSplit each sponge in half. Layer sponge, a thin spread of jam, cream and raspberries.\nFinish with cream and a crown of raspberries on top. Chill 1 hour before slicing.",
    daysAgo: 78,
  },
];

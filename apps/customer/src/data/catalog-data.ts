/**
 * The menu itself — every item, size and price — with no asset imports, so
 * `node:test` (and the menu-export sync test that pins tenants/coffee-story/
 * menu.csv to this model) can reach it. `data/catalog.ts` zips the images
 * back on for the screens.
 *
 * The Service shape keeps its original field names; `minutes` is repurposed
 * as drink size in ounces (12/16/20). Prices in whole dollars.
 */

export type MenuCategoryId =
  | 'coffee'
  | 'signature'
  | 'tea-matcha'
  | 'boba'
  | 'ades-smoothies'
  | 'sandwiches'
  | 'sweets';

export type CatalogSizeData = { slug: string; minutes: number; price: number };

export type CatalogItemData = {
  id: string;
  name: string;
  description: string;
  category: MenuCategoryId;
  /** Each size carries the slug an order is actually made against. */
  durations: readonly CatalogSizeData[];
  /** 86'd: out for the day. Listed, visible, not orderable. */
  soldOutToday?: boolean;
};

export const MENU_CATEGORY_META: readonly { id: MenuCategoryId; title: string; tagline: string }[] = [
  { id: 'coffee', title: 'Coffee & Espresso', tagline: 'Corvus Coffee, pulled with care' },
  { id: 'signature', title: 'Signature Lattes', tagline: 'The drinks that made us famous' },
  { id: 'tea-matcha', title: 'Tea & Matcha', tagline: 'Whisked, brewed, and spiced' },
  { id: 'boba', title: 'Boba', tagline: 'Bubble tea with brown sugar boba' },
  { id: 'ades-smoothies', title: 'Sparkling Ades & Smoothies', tagline: 'Bright, cold, and refreshing' },
  { id: 'sandwiches', title: 'Sandwiches', tagline: 'Halal-friendly, made to order' },
  { id: 'sweets', title: 'Sweets & Desserts', tagline: 'Late-night cravings, sorted' },
] as const;

/** Standard three-size drink ladder around a 16 oz base price. */
function drinkSizes(id: string, base: number) {
  return [
    { slug: `${id}-12`, minutes: 12, price: base - 1 },
    { slug: `${id}-16`, minutes: 16, price: base },
    { slug: `${id}-20`, minutes: 20, price: base + 1 },
  ] as const;
}

/** Food and single-serve items. */
function eachSize(id: string, price: number) {
  return [{ slug: id, minutes: 1, price }] as const;
}

export const CATALOG_ITEMS: readonly CatalogItemData[] = [
  // ---- Coffee & Espresso ----
  { id: 'espresso', name: 'Espresso', description: 'Classic espresso shot.', category: 'coffee', durations: eachSize('espresso', 4) },
  { id: 'americano', name: 'Americano', description: 'Espresso with hot water.', category: 'coffee', durations: drinkSizes('americano', 4) },
  { id: 'latte', name: 'Latte', description: 'Espresso with steamed milk and foam.', category: 'coffee', durations: drinkSizes('latte', 5) },
  { id: 'cappuccino', name: 'Cappuccino', description: 'Equal parts espresso, steamed milk, milk foam.', category: 'coffee', durations: drinkSizes('cappuccino', 5) },
  { id: 'flat-white', name: 'Flat White', description: 'Espresso topped with micro-foamed milk.', category: 'coffee', durations: drinkSizes('flat-white', 5) },
  { id: 'cortado', name: 'Cortado', description: 'Equal parts espresso and warm milk, no foam.', category: 'coffee', durations: eachSize('cortado', 5) },
  { id: 'macchiato', name: 'Macchiato', description: "Espresso 'stained' with milk foam.", category: 'coffee', durations: eachSize('macchiato', 4) },
  { id: 'mocha', name: 'Mocha', description: 'Espresso, steamed milk and chocolate.', category: 'coffee', durations: drinkSizes('mocha', 6) },
  { id: 'cold-brew', name: 'Cold Brew', description: 'Our Corvus Coffee brewed with cold water over many hours.', category: 'coffee', durations: drinkSizes('cold-brew', 5) },
  { id: 'frappe', name: 'Frappes', description: 'Biscoff, caramel, strawberry, or Nutella.', category: 'coffee', durations: drinkSizes('frappe', 7) },

  // ---- Signature Lattes ----
  { id: 'tiramisu-latte', name: 'Tiramisu Latte', description: 'Espresso layered with mascarpone cream, dusted with cocoa.', category: 'signature', durations: drinkSizes('tiramisu-latte', 7) },
  { id: 'spanish-latte', name: 'Spanish Latte', description: 'Espresso with sweetened condensed milk — silky and rich.', category: 'signature', durations: drinkSizes('spanish-latte', 6) },
  { id: 'pistachio-latte', name: 'Pistachio Latte', description: 'House pistachio cream folded into espresso and steamed milk.', category: 'signature', durations: drinkSizes('pistachio-latte', 7) },
  { id: 'ube-latte', name: 'Ube Latte', description: 'Purple yam sweetness swirled into creamy espresso.', category: 'signature', durations: drinkSizes('ube-latte', 7) },
  { id: 'honey-lavender-latte', name: 'Honey Lavender Latte', description: 'Floral lavender and golden honey over espresso.', category: 'signature', durations: drinkSizes('honey-lavender-latte', 6) },
  { id: 'honey-rose-latte', name: 'Honey Rose Latte', description: 'Soft rose notes sweetened with honey.', category: 'signature', durations: drinkSizes('honey-rose-latte', 6) },
  { id: 'brown-sugar-shaken-espresso', name: 'Brown Sugar Shaken Espresso', description: 'Shaken, frothy espresso with caramelized brown sugar.', category: 'signature', durations: drinkSizes('brown-sugar-shaken-espresso', 6) },
  { id: 'biscoff-latte', name: 'Biscoff Latte', description: 'Cookie butter swirled into espresso and milk.', category: 'signature', durations: drinkSizes('biscoff-latte', 7) },
  { id: 'spanish-oat-shaken', name: 'Spanish Oat Milk Shaken Espresso', description: 'Creamy oat milk shaken with sweetened espresso.', category: 'signature', durations: drinkSizes('spanish-oat-shaken', 6) },
  { id: 'libyan-nescafe', name: 'Libyan Nescafe', description: 'The beloved Libyan classic — light, frothy, comforting.', category: 'signature', durations: eachSize('libyan-nescafe', 5) },
  { id: 'turkish-coffee', name: 'Turkish Coffee', description: 'Traditional, slow-brewed and unfiltered — a ritual in a cup.', category: 'signature', durations: [
    { slug: 'turkish-coffee-single', minutes: 8, price: 5 },
    { slug: 'turkish-coffee-double', minutes: 12, price: 7 },
  ] },

  // ---- Tea & Matcha ----
  { id: 'loose-leaf-tea', name: 'Loose Leaf Tea', description: 'Fresh brewed whole tea leaves.', category: 'tea-matcha', durations: eachSize('loose-leaf-tea', 4) },
  { id: 'chai-latte', name: 'Chai Latte', description: 'Black tea blended with cinnamon and cardamom.', category: 'tea-matcha', durations: drinkSizes('chai-latte', 5) },
  { id: 'london-fog', name: 'London Fog', description: 'Earl Grey tea with vanilla and steamed milk.', category: 'tea-matcha', durations: drinkSizes('london-fog', 5) },
  { id: 'matcha-latte', name: 'Matcha Latte', description: 'Finely ground green tea whisked with milk.', category: 'tea-matcha', durations: drinkSizes('matcha-latte', 6) },
  { id: 'strawberry-matcha', name: 'Strawberry Matcha', description: 'Matcha latte layered with strawberry.', category: 'tea-matcha', durations: drinkSizes('strawberry-matcha', 6) },
  { id: 'ube-matcha', name: 'Ube Matcha', description: 'Matcha with purple yam (ube).', category: 'tea-matcha', durations: drinkSizes('ube-matcha', 6) },
  { id: 'orange-blossom-matcha', name: 'Orange Blossom Matcha', description: 'Matcha infused with orange blossom notes.', category: 'tea-matcha', durations: drinkSizes('orange-blossom-matcha', 6) },
  { id: 'honey-lavender-matcha', name: 'Honey Lavender Matcha', description: 'Matcha sweetened with honey and lavender.', category: 'tea-matcha', durations: drinkSizes('honey-lavender-matcha', 6) },
  { id: 'spanish-matcha', name: 'Spanish Matcha', description: 'A creamy matcha made with condensed milk.', category: 'tea-matcha', durations: drinkSizes('spanish-matcha', 6) },
  { id: 'adeni-chai', name: 'Adeni Chai', description: 'Traditional Yemeni chai brewed with black tea and warm spices.', category: 'tea-matcha', durations: drinkSizes('adeni-chai', 5) },

  // ---- Boba ----
  { id: 'boba-milk-tea', name: 'Milk Tea Boba', description: 'Classic creamy milk tea with brown sugar boba.', category: 'boba', durations: [
    { slug: 'boba-milk-tea-16', minutes: 16, price: 6 },
    { slug: 'boba-milk-tea-20', minutes: 20, price: 7 },
  ] },
  { id: 'boba-brown-sugar', name: 'Brown Sugar Boba', description: 'Tiger-stripe brown sugar syrup over fresh milk and boba.', category: 'boba', durations: [
    { slug: 'boba-brown-sugar-16', minutes: 16, price: 6 },
    { slug: 'boba-brown-sugar-20', minutes: 20, price: 7 },
  ] },
  { id: 'boba-ube', name: 'Ube Boba', description: 'Purple yam milk tea with chewy boba pearls.', category: 'boba', durations: [
    { slug: 'boba-ube-16', minutes: 16, price: 6 },
    { slug: 'boba-ube-20', minutes: 20, price: 7 },
  ] },
  { id: 'boba-strawberry', name: 'Strawberry Boba', description: 'Pink strawberry milk tea with boba pearls.', category: 'boba', durations: [
    { slug: 'boba-strawberry-16', minutes: 16, price: 6 },
    { slug: 'boba-strawberry-20', minutes: 20, price: 7 },
  ] },
  { id: 'boba-thai-tea', name: 'Thai Tea Boba', description: 'Bright orange Thai tea over ice with boba.', category: 'boba', durations: [
    { slug: 'boba-thai-tea-16', minutes: 16, price: 6 },
    { slug: 'boba-thai-tea-20', minutes: 20, price: 7 },
  ] },
  { id: 'boba-rooh-afza', name: 'Rooh Afza Boba', description: 'Rose-kissed Rooh Afza milk drink with boba pearls.', category: 'boba', durations: [
    { slug: 'boba-rooh-afza-16', minutes: 16, price: 6 },
    { slug: 'boba-rooh-afza-20', minutes: 20, price: 7 },
  ] },

  // ---- Sparkling Ades & Smoothies ----
  { id: 'ade-strawberry', name: 'Strawberry Sparkling Ade', description: 'Ruby strawberry sparkling ade over ice. Add an energy shot.', category: 'ades-smoothies', durations: drinkSizes('ade-strawberry', 6) },
  { id: 'ade-mango', name: 'Mango Sparkling Ade', description: 'Golden mango sparkling ade over ice.', category: 'ades-smoothies', durations: drinkSizes('ade-mango', 6) },
  { id: 'ade-sunset', name: 'Sunset Sparkling Ade', description: 'Our golden-hour signature — citrus layers over ice.', category: 'ades-smoothies', durations: drinkSizes('ade-sunset', 6) },
  { id: 'ade-passion-fruit', name: 'Passion Fruit Sparkling Ade', description: 'Tropical passion fruit sparkle over ice.', category: 'ades-smoothies', durations: drinkSizes('ade-passion-fruit', 6) },
  { id: 'midnight-lychee', name: 'Midnight Lychee Ade', description: 'Sparkling lychee ade — our late-night favorite.', category: 'ades-smoothies', durations: drinkSizes('midnight-lychee', 6) },
  { id: 'smoothie-strawberry-banana', name: 'Strawberry Banana Smoothie', description: 'Thick, creamy strawberry-banana blend.', category: 'ades-smoothies', durations: drinkSizes('smoothie-strawberry-banana', 7) },
  { id: 'smoothie-mango-banana', name: 'Mango Banana Smoothie', description: 'Golden mango blended smooth with banana.', category: 'ades-smoothies', durations: drinkSizes('smoothie-mango-banana', 7) },
  { id: 'smoothie-strawberry-mango', name: 'Strawberry Mango Smoothie', description: 'Pink and orange layers in one cup.', category: 'ades-smoothies', durations: drinkSizes('smoothie-strawberry-mango', 7) },
  { id: 'smoothie-green-machine', name: 'Green Machine Smoothie', description: 'Vibrant green and mango smoothie — fresh and bright.', category: 'ades-smoothies', durations: drinkSizes('smoothie-green-machine', 7) },
  { id: 'smoothie-banana-date', name: 'Banana Date Smoothie', description: 'Creamy banana with sweet dates and honey.', category: 'ades-smoothies', durations: drinkSizes('smoothie-banana-date', 7) },

  // ---- Sandwiches ----
  { id: 'sandwich-teriyaki', name: 'Teriyaki Chicken Sandwich', description: 'Teriyaki chicken, mozzarella, avocado, sun-dried tomato and pesto on white bread.', category: 'sandwiches', durations: eachSize('sandwich-teriyaki', 10) },
  { id: 'wrap-chicken-caesar', name: 'Chicken Caesar Wrap', description: 'Chicken, romaine, parmesan and Caesar dressing in a tortilla.', category: 'sandwiches', durations: eachSize('wrap-chicken-caesar', 9) },
  { id: 'panini-mozzarella', name: 'Mozzarella Panini', description: 'Mozzarella, roasted red pepper, tomato, pesto and balsamic glaze.', category: 'sandwiches', durations: eachSize('panini-mozzarella', 9) },
  { id: 'sandwich-veggie', name: 'Veggie Sandwich', description: 'Spring mix, avocado, tomato, mozzarella, pesto and balsamic on white bread.', category: 'sandwiches', durations: eachSize('sandwich-veggie', 9) },
  { id: 'avocado-toast', soldOutToday: true, name: 'Avocado Toast', description: 'Avocado, cherry tomato, pepper and balsamic glaze on toast.', category: 'sandwiches', durations: eachSize('avocado-toast', 8) },
  { id: 'grilled-cheese', name: 'Grilled Cheese', description: 'Mozzarella, cheddar and provolone on buttered toast.', category: 'sandwiches', durations: eachSize('grilled-cheese', 7) },
  { id: 'toasted-bagel', name: 'Toasted Bagels', description: 'Plain or everything bagel with cream cheese.', category: 'sandwiches', durations: eachSize('toasted-bagel', 4) },

  // ---- Sweets & Desserts ----
  { id: 'strawberry-nutella-croissant', name: 'Strawberry Nutella Croissant', description: 'Fresh baked croissant stuffed with Nutella, topped with strawberry and Nutella drizzle.', category: 'sweets', durations: eachSize('strawberry-nutella-croissant', 6) },
  { id: 'croissant-cheese-honey', name: 'Cheese & Honey Croissant', description: 'Croissant stuffed with cream cheese, topped with honey drizzle.', category: 'sweets', durations: eachSize('croissant-cheese-honey', 6) },
  { id: 'honeycomb-cheese-bread', name: 'Honeycomb Cheese Bread', description: 'Topped with Nutella, Biscoff, or white chocolate.', category: 'sweets', durations: eachSize('honeycomb-cheese-bread', 7) },
  { id: 'honeycomb-condensed', name: 'Condensed Milk Honeycomb', description: 'Honeycomb cheese bread soaked in condensed milk.', category: 'sweets', durations: eachSize('honeycomb-condensed', 8) },
  { id: 'honeycomb-bites', name: 'Honeycomb Bites', description: 'Bite-size honeycomb cheese bread.', category: 'sweets', durations: eachSize('honeycomb-bites', 5) },
  { id: 'milk-cake', name: 'Flavored Milk Cakes', description: 'Tres leches style cakes — pistachio, lotus, or saffron.', category: 'sweets', durations: eachSize('milk-cake', 7) },
  { id: 'mochi-donut', name: 'Mochi Donut', description: 'Chewy, glazed, made fresh — pistachio, ube, or Nutella.', category: 'sweets', durations: [
    { slug: 'mochi-donut-single', minutes: 1, price: 4 },
    { slug: 'mochi-donut-trio', minutes: 3, price: 10 },
  ] },
] as const;

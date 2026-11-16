/**
 * Group POS items into brands ("Dr Pepper", "Coca-Cola", "Monster" …) from the
 * item name alone — the POS has no brand field. A list of known brands is
 * matched first; anything else falls back to the first meaningful word, so a
 * new brand still groups with itself ("Jumex Pineapple" + "Jumex Guava").
 */

const RULES: [RegExp, string][] = [
  // Soda / drinks
  [/\bdr ?pep(per)?\b|\bdrpepper\b/, "Dr Pepper"],
  [/\bcoca ?cola\b|\bcoke\b|\bcocacola\b/, "Coca-Cola"],
  [/\bpepsi\b/, "Pepsi"],
  [/\b(mountain|mtn|mt) dew\b/, "Mountain Dew"],
  [/\bsprite\b/, "Sprite"],
  [/\bfanta\b/, "Fanta"],
  [/\bbig (red|blue|pineapple|peach|grape|strawberry)\b/, "Big Red"],
  [/\bgatorade\b|\bgatorlyte\b/, "Gatorade"],
  [/\bpowerade\b/, "Powerade"],
  [/\bbody ?armor\b/, "BodyArmor"],
  [/\bjumex\b/, "Jumex"],
  [/\belectrolit\b/, "Electrolit"],
  [/\ba ?w\b|\ba and w\b/, "A&W"],
  [/\barizona\b/, "Arizona"],
  [/\bminute maid\b/, "Minute Maid"],
  [/\btropical fantasy\b/, "Tropical Fantasy"],
  [/\bsnapple\b/, "Snapple"],
  [/\bshasta\b/, "Shasta"],
  [/\bfaygo\b/, "Faygo"],
  [/\bcalypso\b/, "Calypso"],
  [/\bsquirt\b/, "Squirt"],
  [/\b7 ?up\b/, "7UP"],
  [/\bcanada dry\b/, "Canada Dry"],
  [/\bsimply\b/, "Simply"],
  [/\bstarbucks\b/, "Starbucks"],
  [/\bpure leaf\b/, "Pure Leaf"],
  [/\bbrisk\b/, "Brisk"],
  [/\bgood 2 grow\b/, "Good2Grow"],
  [/\baloe\b|\bokf\b/, "Aloe Vera King"],
  [/\btopo chico\b/, "Topo Chico"],
  [/\bjarritos\b/, "Jarritos"],
  [/\bvitamin water\b|\bv ?water\b|\bvwtr\b/, "Vitaminwater"],
  [/\bgold peak\b/, "Gold Peak"],
  [/\btum+ie yum+ie\b/, "Tummy Yummy"],
  [/\bmr pibb\b/, "Mr Pibb"],
  // Energy
  [/red ?bull\b/, "Red Bull"],
  [/\bmonster\b|\bmnstr\b/, "Monster"],
  [/\b5 ?(hour|hr)\b/, "5-hour Energy"],
  [/\bvenom\b/, "Venom"],
  [/\balani\b/, "Alani Nu"],
  [/\breign\b/, "Reign"],
  [/\bcelsius\b/, "Celsius"],
  [/\bc4\b/, "C4"],
  [/\bghost\b/, "Ghost"],
  [/\brockstar\b/, "Rockstar"],
  [/\bbloom\b/, "Bloom"],
  [/\bcore power\b/, "Core Power"],
  [/\bmuscle milk\b/, "Muscle Milk"],
  [/\brip it\b/, "Rip It"],
  // Beer / malt
  [/\bbud light\b/, "Bud Light"],
  [/\bbud ice\b/, "Bud Ice"],
  [/\bbudweiser\b/, "Budweiser"],
  [/\bbusch\b/, "Busch"],
  [/\bmichelob\b|\bmich ult/, "Michelob Ultra"],
  [/\bmodelo\b|\bmod che\b/, "Modelo"],
  [/\bcorona\b/, "Corona"],
  [/\bcoors\b/, "Coors"],
  [/\bmiller\b/, "Miller"],
  [/\bnatural light\b|\bnatty\b/, "Natural Light"],
  [/\bkeystone\b/, "Keystone"],
  [/\bdos equis\b/, "Dos Equis"],
  [/\btwisted tea\b/, "Twisted Tea"],
  [/\bloko\b/, "Four Loko"],
  [/\bcayman jack\b/, "Cayman Jack"],
  [/\bsmirnoff\b/, "Smirnoff"],
  [/\bwhite claw\b/, "White Claw"],
  [/\bvictoria\b/, "Victoria"],
  [/\bpacifico\b/, "Pacifico"],
  [/\bsteel reserve\b/, "Steel Reserve"],
  [/\bmilwaukee/, "Milwaukee's Best"],
  [/\bbeat ?box\b/, "BeatBox"],
  [/\bmonaco\b|\bmnco\b/, "Monaco"],
  [/\bshiner\b/, "Shiner"],
  [/\btruly\b/, "Truly"],
  [/\blytt\b/, "Lytt"],
  // Cigarettes
  [/\bmarlboro\b|\bmarl\b/, "Marlboro"],
  [/\bnewport\b/, "Newport"],
  [/\bcamel\b/, "Camel"],
  [/\bkool\b/, "Kool"],
  [/\bpall mall\b/, "Pall Mall"],
  [/\blucky strike\b/, "Lucky Strike"],
  [/\bmontego\b/, "Montego"],
  [/\bseneca\b/, "Seneca"],
  [/\b305s?\b/, "305s"],
  [/\bld\b/, "LD"],
  [/\bmisty\b/, "Misty"],
  [/\bvirginia slim/, "Virginia Slims"],
  [/\bsalem\b/, "Salem"],
  [/\bwinston\b/, "Winston"],
  [/\bl ?m green\b|\bl and m\b/, "L&M"],
  [/\bamerican spirit\b/, "American Spirit"],
  // Smokeless / cigars
  [/\bcopenhagen\b|\bcope\b/, "Copenhagen"],
  [/\bgrizzly\b/, "Grizzly"],
  [/\blonghorn\b/, "Longhorn"],
  [/\bskoal\b/, "Skoal"],
  [/\bzyn\b/, "Zyn"],
  [/\bvelo\b/, "Velo"],
  [/\bon plus\b/, "on!"],
  [/\bswish/, "Swisher"],
  [/\bwhite owl\b|\bw owl\b|\bwhiteowl\b/, "White Owl"],
  [/\bblack (and |n )?mild\b|\bb m\b|\bblk\b/, "Black & Mild"],
  [/\bbackwoods\b/, "Backwoods"],
  [/\b4 ?k(ing)?s?\b/, "4 Kings"],
  [/\bpom pom\b/, "Pom Pom"],
  [/\bslapwoods\b/, "Slapwoods"],
  [/\bgame\b/, "Game"],
  // Vape / CBD
  [/\bgeek ?ba[er]\b|\bgeekbar\b|\bgb\b/, "Geek Bar"],
  [/\bfog+er\b/, "Foger"],
  [/\blost ?mary\b/, "Lost Mary"],
  [/\braw\b/, "RAW"],
  [/\bzig/, "Zig-Zag"],
  [/\bhemparillo\b/, "Hemparillo"],
  [/\bvuse\b/, "Vuse"],
  // Candy / snacks
  [/\breese/, "Reese's"],
  [/\bsnickers?\b/, "Snickers"],
  [/\bm ?ms?\b|\bm and m/, "M&M's"],
  [/\bn l\b|\bnow ?(and )?later\b/, "Now & Later"],
  [/\bskittles\b/, "Skittles"],
  [/\btwix\b/, "Twix"],
  [/\bhersheys?\b/, "Hershey's"],
  [/\bstarburst\b/, "Starburst"],
  [/\btakis\b/, "Takis"],
  [/\bcheetos\b/, "Cheetos"],
  [/\bdoritos?\b/, "Doritos"],
  [/\bpringles\b/, "Pringles"],
  [/\bslim jim\b/, "Slim Jim"],
  [/\blittle debbie\b/, "Little Debbie"],
];

/** Words that describe a variant, not a brand — skipped by the fallback. */
const MODIFIERS = new Set([
  "diet", "zero", "sugar", "free", "the", "new", "mini", "minis", "mexican", "holiday", "king", "size", "lite", "light",
  "original", "classic", "single", "can", "btl", "bottle", "oz", "pk", "pack", "ct", "x",
]);

export function normalizeName(name: string): string {
  return ` ${name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

export function brandOf(name: string): string {
  const n = normalizeName(name);
  for (const [re, brand] of RULES) if (re.test(n)) return brand;
  const word = n.trim().split(" ").find((w) => w.length > 1 && !MODIFIERS.has(w) && !/^\d/.test(w));
  if (!word) return "Other";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

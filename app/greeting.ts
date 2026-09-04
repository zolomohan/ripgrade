/**
 * The line the dashboard opens on.
 *
 * It was "Welcome back", which is what a page says when it has nothing to say
 * about itself. These are the same greeting in the app's own voice: about the
 * shelf and the drive rather than about you, short enough to sit on one line
 * at the heading's size, and none of them claiming to know anything the page
 * has not counted.
 */
const GREETINGS = [
  "Welcome back",
  "The shelf is as you left it",
  "Everything is where you put it",
  "Back to the shelf",
  "Still here, still counted",
  "The library, as it stands",
  "Good to see you",
  "The drive has been quiet",
  "Here is where you left off",
] as const;

/**
 * Picked on the server, per request.
 *
 * The dashboard is a client component, so a pick made while rendering it would
 * be made twice — once into the HTML and once again in the browser — and the
 * two would disagree. The page above it is `force-dynamic` and already runs
 * fresh on every visit, so the choice is made there and travels down as a
 * string, which is a prop React has no opinion about.
 */
export function pickGreeting(): string {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

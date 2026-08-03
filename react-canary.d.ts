/**
 * `<ViewTransition>` lives on React's canary channel, which is what the App
 * Router runs on — Next bundles it, so nothing extra is installed. Its types
 * are shipped separately though, and this is what loads them: the import has no
 * bindings because the file only exists to pull in the module augmentation.
 *
 * Done here rather than through tsconfig's `types` array, which would replace
 * the automatically included @types packages rather than adding to them.
 */
import {} from "react/canary";

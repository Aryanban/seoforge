/** Piscina worker entry: runs processPage off the main thread. */
import { processPage, PageTask } from "./page-processor.js";

export default function run(task: PageTask) {
  return processPage(task);
}

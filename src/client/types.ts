export interface IndexEntry {
  /** Short label shown in search results */
  displayText: string;
  /** Full text content used for matching */
  searchText: string;
  /** Index of the sidebar button in the NodeList */
  menuButtonIdx: number;
  /** Sidebar button label (e.g., "Chat Bot") */
  menuLabel: string;
  /** Index of the submenu tab (-1 if no submenu) */
  subIdx: number;
  /** Submenu tab label (e.g., "Parameters") */
  subLabel: string;
}

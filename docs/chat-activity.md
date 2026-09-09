# Chat execution activity

Project chat and paper chat render one ordered transcript from the provider's public stream. Text remains in the conversation; thinking and tool steps use compact, expandable rows. Thinking is shown only when the provider actually emits it. Envoi does not generate a substitute reasoning narrative for models that omit it.

`appendChatEvent` is shared by the backend transcript writer and both frontend consumers. Adjacent text/thinking deltas coalesce. Tool start, partial output, and completion merge by call ID, preserving the original input and start time. Partial output replaces the previous preview instead of accumulating snapshots in the compatibility tool log. Saved `parts` preserve order and thinking across reopening; old transcripts retain their text and merge tool pairs without claiming to reconstruct missing chronology.

Active steps show elapsed wall time. After 15 seconds without a new event, the UI reports how long no update has arrived and leaves the stop action available. This is an observation of the stream, not proof that a remote model is still making progress or has failed. Finished steps show a check or error; unfinished tools in a stopped transcript are marked interrupted. Tool input and output remain expandable. Streaming follows the bottom only while the reader is near it.

Validation: `npm run test:ai` covers the shared reducer and real SDK loopback reasoning persistence; `node scripts/test-background-agent-ui.mjs` covers ordering, expandable thinking, partial tool output, single-row completion, inactivity feedback, and background workspace continuity. Fixtures do not invoke paid models.

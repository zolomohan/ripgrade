<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Finding code

For "where is X used", "what calls this", or "what breaks if I change Y", prefer the `codegraph_explore` MCP tool over grep — it answers from the indexed call graph in `.codegraph/`, with callers and impact radius grep can't see.

export const REALTIME_VOICE = "marin";

export const CANVAS_REALTIME_INSTRUCTIONS = `
You are Drawcast, a live voice agent controlling an Excalidraw canvas.

Core behavior:
- Speak briefly and naturally while working.
- Before any canvas tool call, say one short preamble like "I'll draw that now" or "Let me update the board."
- Use tools for canvas changes. Do not claim a change is complete until the relevant tool succeeds.
- Before drawing or editing, inspect the board with analyze_canvas or get_canvas_state. Treat existing content as real occupied space.
- For exact geometry, use create_shape and create_connector. For pencil, sketch, handwritten, hand-drawn, or freeform requests, use draw_freeform instead of exact shapes.
- draw_freeform takes sparse anchor points and turns them into human-like vector pencil strokes with medium stroke defaults, jitter, and pressure variation. Decompose letters or symbols into separate natural strokes. For example, a handwritten "A" is left upstroke, right downstroke, then crossbar.
- After substantial drawing, handwriting/freeform work, label placement, or any correction where the user has been struggling, call capture_canvas_snapshot with low detail and analyze_canvas before saying the work is complete. If visual QA reports overlap, illegible text, offscreen content, or wrong geometry, fix it first and then re-check.
- For simple direct edits, use create_shape, create_connector, draw_freeform, move_elements, resize_elements, set_style, delete_elements, duplicate_elements, arrange_elements, align_elements, group_elements, select_elements, repair_layout, focus_region, or laser_point_at_element.
- For full diagrams or multi-node architecture/flowchart requests, use generate_diagram_from_instruction. Pick the playback mode:
  - "slow": default teacher-like visual build
  - "fast": one-shot generation when the user asks for speed
  - "explanatory": slower build intended for spoken walkthroughs
- If the user asks for another/new/separate diagram and the canvas already has content, use placement "new-section" so existing work is moved left and the new section is drawn in clean space.
- If a tool result reports spacing or text warnings, call repair_layout or focus_region before saying the board is done.
- When explaining an existing diagram out loud, first call get_canvas_state, then speak through the flow using the exact visible element labels in order. The client syncs the laser to those labels as you say them.
- Use laser_explain_elements only for silent visual tracing, or when the user explicitly asks to just show the laser path without spoken timing.
- If a tool fails, explain the failure briefly and ask for the missing detail.
- Keep explanations short unless the user explicitly asks for a walkthrough.
- When exact element ids are needed, call get_canvas_state first.
`;

export const CANVAS_REALTIME_TOOLS = [
  {
    type: "function",
    name: "get_canvas_state",
    description:
      "Inspect the current Excalidraw canvas. Use this before editing existing elements by id or explaining what is currently on the board.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "analyze_canvas",
    description:
      "Inspect viewport, scene bounds, zoom, element count, overlap warnings, and text readability warnings. Use before drawing or editing.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_workspace",
    description:
      "Make clean space for a new drawing by moving existing content left or right and returning the viewport to a normal 90-100% zoom.",
    parameters: {
      type: "object",
      properties: {
        moveExisting: {
          type: "string",
          enum: ["left", "right"],
          description:
            "Direction to move existing board content. Default is left so the current workspace becomes clear.",
        },
        padding: {
          type: "number",
          description: "Minimum canvas-space gap between old content and new workspace.",
        },
        zoom: {
          type: "number",
          description:
            "Target viewport zoom after preparing space. Use 0.9-1.0 for normal work.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_shape",
    description:
      "Create one shape or text label on the canvas. Best for simple requests like adding a box, circle, decision diamond, or text note.",
    parameters: {
      type: "object",
      properties: {
        shape: {
          type: "string",
          enum: ["rectangle", "ellipse", "diamond", "text"],
        },
        label: {
          type: "string",
          description: "Visible label to put inside the shape.",
        },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
      },
      required: ["shape"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_connector",
    description:
      "Create an arrow or line between two existing elements or explicit canvas coordinates. Use this for direct Excalidraw arrow/line creation.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["arrow", "line"],
        },
        startElementId: {
          type: "string",
          description: "Optional source element id to connect from.",
        },
        endElementId: {
          type: "string",
          description: "Optional target element id to connect to.",
        },
        x1: { type: "number" },
        y1: { type: "number" },
        x2: { type: "number" },
        y2: { type: "number" },
        label: { type: "string" },
        strokeColor: { type: "string" },
        strokeWidth: { type: "number" },
        strokeStyle: {
          type: "string",
          enum: ["solid", "dashed", "dotted"],
        },
        endArrowhead: {
          type: ["string", "null"],
          enum: ["arrow", "bar", "dot", "diamond", null],
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "draw_freeform",
    description:
      "Draw vector freeform pencil/pen strokes. Use for handwriting, organic arrows, sketched circles, emphasis marks, and anything that should look manually drawn. Provide sparse anchor points; the tool adds human-like point density, jitter, pressure, and animated playback.",
    parameters: {
      type: "object",
      properties: {
        strokes: {
          type: "array",
          description:
            "Each stroke is either an array of points or an object with points and optional style overrides. Points are local coordinates unless x/y are supplied.",
          items: {
            anyOf: [
              {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    pressure: { type: "number" },
                  },
                  required: ["x", "y"],
                  additionalProperties: false,
                },
              },
              {
                type: "object",
                properties: {
                  points: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                        pressure: { type: "number" },
                      },
                      required: ["x", "y"],
                      additionalProperties: false,
                    },
                  },
                  strokeColor: { type: "string" },
                  strokeWidth: { type: "number" },
                  opacity: { type: "number" },
                  pressure: { type: "number" },
                  wobble: { type: "number" },
                  spacing: { type: "number" },
                  closed: { type: "boolean" },
                },
                required: ["points"],
                additionalProperties: false,
              },
            ],
          },
        },
        points: {
          type: "array",
          description:
            "Shortcut for a single stroke. Prefer strokes for letters and multi-stroke drawings.",
          items: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              pressure: { type: "number" },
            },
            required: ["x", "y"],
            additionalProperties: false,
          },
        },
        x: {
          type: "number",
          description:
            "Canvas x coordinate for the local stroke bounds. Omit to place in open space.",
        },
        y: {
          type: "number",
          description:
            "Canvas y coordinate for the local stroke bounds. Omit to place in open space.",
        },
        scale: { type: "number" },
        style: {
          type: "string",
          enum: ["pencil", "pen", "marker"],
          description: "Pencil is the default medium freeform feel.",
        },
        strokeColor: { type: "string" },
        strokeWidth: {
          type: "number",
          description: "Use about 3 for a medium pencil line.",
        },
        opacity: { type: "number" },
        pressure: { type: "number" },
        wobble: {
          type: "number",
          description:
            "Human imperfection amount. 0 is exact, 1-2 is natural, 3+ is sketchy.",
        },
        spacing: {
          type: "number",
          description:
            "Distance between generated points. Lower means more points and smoother strokes.",
        },
        playback: {
          type: "boolean",
          description:
            "Animate the stroke being drawn. Defaults to true for freeform.",
        },
        speedMs: {
          type: "number",
          description: "Milliseconds between playback frames. 16-28 feels natural.",
        },
        focus: { type: "boolean" },
        zoom: { type: "number" },
        group: { type: "boolean" },
        seed: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "generate_diagram_from_instruction",
    description:
      "Generate or relayout a full diagram from a natural-language instruction. Use for multi-node system architectures, process flows, and structural redraws.",
    parameters: {
      type: "object",
      properties: {
        instruction: {
          type: "string",
          description:
            "The user's desired diagram change or full diagram description.",
        },
        mode: {
          type: "string",
          enum: ["slow", "fast", "explanatory"],
          description:
            "Playback style. Use slow by default, fast for one-shot, explanatory for teaching.",
        },
        placement: {
          type: "string",
          enum: ["auto", "update-existing", "new-section"],
          description:
            "Whether to update existing content or create a clean new section. Use new-section for another/separate diagram.",
        },
      },
      required: ["instruction"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "delete_elements",
    description:
      "Delete/erase existing elements by id, or the current selection if no ids are supplied. Call get_canvas_state first unless ids are already known.",
    parameters: {
      type: "object",
      properties: {
        elementIds: {
          type: "array",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "duplicate_elements",
    description:
      "Duplicate existing elements by id, or the current selection if no ids are supplied.",
    parameters: {
      type: "object",
      properties: {
        elementIds: {
          type: "array",
          items: { type: "string" },
        },
        dx: { type: "number" },
        dy: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "move_elements",
    description:
      "Move existing elements by id. Call get_canvas_state first unless ids are already known.",
    parameters: {
      type: "object",
      properties: {
        elementIds: {
          type: "array",
          items: { type: "string" },
        },
        dx: { type: "number" },
        dy: { type: "number" },
        moveAll: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "resize_elements",
    description:
      "Resize existing elements by id, or the current selection if no ids are supplied. Use either width/height or scale.",
    parameters: {
      type: "object",
      properties: {
        elementIds: {
          type: "array",
          items: { type: "string" },
        },
        width: { type: "number" },
        height: { type: "number" },
        scale: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "set_style",
    description:
      "Apply Excalidraw styling to existing elements by id, or the current selection if no ids are supplied.",
    parameters: {
      type: "object",
      properties: {
        elementIds: {
          type: "array",
          items: { type: "string" },
        },
        strokeColor: { type: "string" },
        backgroundColor: { type: "string" },
        fillStyle: {
          type: "string",
          enum: ["hachure", "cross-hatch", "solid", "zigzag"],
        },
        strokeWidth: { type: "number" },
        strokeStyle: {
          type: "string",
          enum: ["solid", "dashed", "dotted"],
        },
        roughness: { type: "number" },
        opacity: { type: "number" },
        fontSize: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "arrange_elements",
    description:
      "Change z-order of elements: bring to front, send to back, move forward, or move backward.",
    parameters: {
      type: "object",
      properties: {
        elementIds: {
          type: "array",
          items: { type: "string" },
        },
        action: {
          type: "string",
          enum: ["front", "back", "forward", "backward"],
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "align_elements",
    description:
      "Align or distribute selected/existing elements by id. Use for left/right/center/top/middle/bottom and horizontal/vertical distribution.",
    parameters: {
      type: "object",
      properties: {
        elementIds: {
          type: "array",
          items: { type: "string" },
        },
        action: {
          type: "string",
          enum: [
            "left",
            "center",
            "right",
            "top",
            "middle",
            "bottom",
            "distribute_horizontal",
            "distribute_vertical"
          ],
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "group_elements",
    description:
      "Group or ungroup existing elements by id, or the current selection if no ids are supplied.",
    parameters: {
      type: "object",
      properties: {
        elementIds: {
          type: "array",
          items: { type: "string" },
        },
        action: {
          type: "string",
          enum: ["group", "ungroup"],
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "update_elements",
    description:
      "Update existing element properties by id, such as colors or text. Call get_canvas_state first unless ids are already known.",
    parameters: {
      type: "object",
      properties: {
        updates: {
          type: "object",
          description:
            "Object keyed by element id. Values are partial Excalidraw element properties.",
          additionalProperties: true,
        },
      },
      required: ["updates"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "select_elements",
    description:
      "Select existing elements by id. Call get_canvas_state first unless ids are already known.",
    parameters: {
      type: "object",
      properties: {
        elementIds: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["elementIds"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "zoom_to_fit",
    description:
      "Zoom the viewport to fit all elements, or specific element ids if supplied.",
    parameters: {
      type: "object",
      properties: {
        elementIds: {
          type: "array",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "focus_region",
    description:
      "Pan/zoom the viewport to a region or element set. Prefer zoom 0.9-1.0 for final focus; use fit only for overview.",
    parameters: {
      type: "object",
      properties: {
        elementIds: {
          type: "array",
          items: { type: "string" },
        },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        zoom: { type: "number" },
        fit: { type: "boolean" },
        padding: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "repair_layout",
    description:
      "Repair obvious spacing issues by spreading overlapping shapes/text and reporting remaining layout warnings.",
    parameters: {
      type: "object",
      properties: {
        padding: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "capture_canvas_snapshot",
    description:
      "Capture the rendered canvas as a small image and run visual QA with a vision model. Use after complex freeform drawings, text/label placement, shape changes, or when the user explicitly asks you to inspect the board visually. The result returns textual issues that you can act on.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Short note about what to visually check, such as handwriting shape, overlap, or offscreen placement.",
        },
        detail: {
          type: "string",
          enum: ["low", "auto", "high"],
          description: "Use low unless tiny details matter.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "laser_point_at_element",
    description:
      "Point at one existing element with a human-like laser movement and optional circle. Use laser_explain_elements instead for multi-step walkthroughs.",
    parameters: {
      type: "object",
      properties: {
        elementId: { type: "string" },
        circle: { type: "boolean" },
        speedMs: { type: "number" },
        dwellFrames: { type: "number" },
      },
      required: ["elementId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "laser_explain_elements",
    description:
      "Move the laser pointer through an ordered set of existing elements with human-like curved motion, small dwell movements, and optional circling. Best for teacher-style explanations of a completed diagram.",
    parameters: {
      type: "object",
      properties: {
        elementIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Element ids in the exact order they should be explained.",
        },
        circle: {
          type: "boolean",
          description: "Whether to circle each element while explaining it.",
        },
        speedMs: {
          type: "number",
          description:
            "Milliseconds per animation point. Lower is faster; 18-28 feels natural.",
        },
        dwellFrames: {
          type: "number",
          description:
            "Small stationary movement frames at each element. 20-35 feels natural.",
        },
      },
      required: ["elementIds"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "laser_trace_path",
    description:
      "Trace an explicit laser path across canvas coordinates. Use only when element ids are not enough.",
    parameters: {
      type: "object",
      properties: {
        points: {
          type: "array",
          items: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
            },
            required: ["x", "y"],
            additionalProperties: false,
          },
        },
        speedMs: { type: "number" },
      },
      required: ["points"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "clear_laser",
    description: "Immediately clear the assistant laser pointer from the canvas.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

export type CanvasRealtimeToolName =
  (typeof CANVAS_REALTIME_TOOLS)[number]["name"];

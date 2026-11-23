---
title: Visualizer
description: Follow your workspace's agent activity as a graph, in a tab, picture in picture, or behind Chat.
nav: Visualizer
order: 32
category: Workspaces
---

<!-- OTTO(visualizer): restored canonical session graph. -->

# Visualizer

Open **Visualizer** in the workspace header. Choose a tab, **Picture in picture**,
or **Chat background**. It uses the sessions already open in that workspace,
including their child agents. It works with every provider; values a provider
does not report stay unavailable.

The tab toolbar lets you choose a chat or **All active chats**, follow the focused
chat, pin your selection, zoom to fit, mute graph effects and open PIP. Its options
include Timeline, File activity, Reported cost, Failures and Node statistics.
Failures show actual tool errors; the full conversation stays in Chat.

PIP can move anywhere in the window. Hover or focus it to show its toolbar. On
touch layouts the controls stay visible. Choose Small or Medium in its menu,
expand back to the tab, or close it. Inactive workspaces retain their saved tabs
while their graph renderer stops.

Chat background keeps your conversation readable over a fixed graph. **Show
Visualizer only** hides the conversation while leaving the message composer
available. **Show conversation** restores it. Sending a message keeps your
chosen view. On desktop, dwelling over empty conversation space briefly dims
the text without changing your scroll position.

**Settings, Visualizer** controls device preferences such as render quality,
agent shape, context display, graph effects, sound, panels and PIP size. Spoken
replies and activity cues remain in Speech settings. Graph sound does not enable
microphone capture.

An empty workspace offers **Start demo** and **Stop demo**. Demo displays sample
activity without running an agent. It is unavailable while chats are open.
If the renderer stops or cannot become ready, use **Reconnect Visualizer**.

The renderer is packaged offline. It cannot browse the network or access your
app settings. Its original license and attribution are available in **Settings,
About**.

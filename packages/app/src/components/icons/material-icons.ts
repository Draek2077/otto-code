import { createElement, type ComponentType } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { SvgXml } from "react-native-svg";
import { MATERIAL_SYMBOL_SVGS } from "@/assets/material-symbol-icons";
import { withBrainGlyphScale } from "@/components/icons/brain-glyph-scale";

export type IconComponent = ComponentType<{
  size: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}>;

function createMaterialSymbolIcon(name: keyof typeof MATERIAL_SYMBOL_SVGS): IconComponent {
  const svg = MATERIAL_SYMBOL_SVGS[name];
  const MaterialSymbolIcon: IconComponent = ({ size, color, style }) =>
    createElement(SvgXml, { xml: svg, width: size, height: size, color, style });
  MaterialSymbolIcon.displayName = `MaterialSymbolIcon(${name})`;
  return MaterialSymbolIcon;
}

// The `chat` / `mark_unread_chat_alt` pair draws optically high in its box
// across the whole Material Symbols set (not something specific to this
// project), so nudge just these two down rather than re-cropping every icon's
// generated viewBox.
function createVerticallyNudgedMaterialSymbolIcon(
  name: keyof typeof MATERIAL_SYMBOL_SVGS,
  offsetY: number,
): IconComponent {
  const Icon = createMaterialSymbolIcon(name);
  const NudgedIcon: IconComponent = ({ size, color, style }) =>
    createElement(Icon, { size, color, style: [{ transform: [{ translateY: offsetY }] }, style] });
  NudgedIcon.displayName = `NudgedMaterialSymbolIcon(${name})`;
  return NudgedIcon;
}

function createScaledBrainIcon(name: keyof typeof MATERIAL_SYMBOL_SVGS): IconComponent {
  return withBrainGlyphScale(createMaterialSymbolIcon(name), name);
}

export const Abc = createMaterialSymbolIcon("Abc");
export const Activity = createMaterialSymbolIcon("Activity");
export const AddColumnRight = createMaterialSymbolIcon("AddColumnRight");
export const AddLink = createMaterialSymbolIcon("AddLink");
export const AddRowBelow = createMaterialSymbolIcon("AddRowBelow");
export const AlarmClock = createMaterialSymbolIcon("AlarmClock");
export const AlertTriangle = createMaterialSymbolIcon("AlertTriangle");
export const AlignJustify = createMaterialSymbolIcon("AlignJustify");
export const Architecture = createMaterialSymbolIcon("Architecture");
export const Archive = createMaterialSymbolIcon("Archive");
export const ArrowDown = createMaterialSymbolIcon("ArrowDown");
export const ArrowDownUp = createMaterialSymbolIcon("ArrowDownUp");
export const ArrowLeft = createMaterialSymbolIcon("ArrowLeft");
export const ArrowLeftToLine = createMaterialSymbolIcon("ArrowLeftToLine");
export const ArrowRight = createMaterialSymbolIcon("ArrowRight");
export const ArrowRightToLine = createMaterialSymbolIcon("ArrowRightToLine");
export const ArrowUp = createMaterialSymbolIcon("ArrowUp");
export const ArrowUpRight = createMaterialSymbolIcon("ArrowUpRight");
export const ArrowUpToLine = createMaterialSymbolIcon("ArrowUpToLine");
export const Assignment = createMaterialSymbolIcon("Assignment");
export const AudioLines = createMaterialSymbolIcon("AudioLines");
export const BarChart = createMaterialSymbolIcon("BarChart");
export const Blocks = createMaterialSymbolIcon("Blocks");
export const BookOpen = createMaterialSymbolIcon("BookOpen");
export const Bot = createMaterialSymbolIcon("Bot");
export const Boxes = createMaterialSymbolIcon("Boxes");
// Material's `network_intelligence` - the circuit brain. NOT `psychology`, which
// is a head with a gear in it and is not a brain at all.
//
// The whole rail state machine draws from this one family, which is why it was
// chosen over the plain `neurology` brain: the family ships four ready-made
// variants of the same silhouette, so the states that need their own glyph get
// one that is unmistakably the same object, and every other state is a colour.
//
// The family draws larger than the box it is laid out in - see
// `brain-glyph-scale.ts` for the factor and for why it overflows rather than
// cropping its viewBox.
export const Brain = createScaledBrainIcon("Brain");
export const BrainBenchmark = createScaledBrainIcon("BrainBenchmark");
export const BrainDownload = createScaledBrainIcon("BrainDownload");
export const BrainError = createScaledBrainIcon("BrainError");
export const BrainScan = createScaledBrainIcon("BrainScan");
// Marks for the two ops the family ships no variant for. These are NOT whole
// icons: each sits in a round gap bitten out of the base brain, the same way the
// family's own clock and arrow do. Both are the filled weight and round in
// outline, which is what lets them fill that gap without a seam.
export const BrainCalibrate = createMaterialSymbolIcon("BrainCalibrate");
export const BrainSweep = createMaterialSymbolIcon("BrainSweep");
export const CalendarClock = createMaterialSymbolIcon("CalendarClock");
export const CalendarMonth = createMaterialSymbolIcon("CalendarMonth");
export const CalendarPlus = createMaterialSymbolIcon("CalendarPlus");
export const Camera = createMaterialSymbolIcon("Camera");
export const Check = createMaterialSymbolIcon("Check");
export const CheckCircle = createMaterialSymbolIcon("CheckCircle");
export const CheckCircle2 = createMaterialSymbolIcon("CheckCircle2");
export const Checklist = createMaterialSymbolIcon("Checklist");
export const CheckSquare = createMaterialSymbolIcon("CheckSquare");
export const Chat = createVerticallyNudgedMaterialSymbolIcon("Chat", 1);
export const ChatBubble = createMaterialSymbolIcon("ChatBubble");
export const ChatBubbleOff = createMaterialSymbolIcon("ChatBubbleOff");
export const ChevronDown = createMaterialSymbolIcon("ChevronDown");
export const ChevronUp = createMaterialSymbolIcon("ChevronUp");
export const ChevronLeft = createMaterialSymbolIcon("ChevronLeft");
export const ChevronRight = createMaterialSymbolIcon("ChevronRight");
export const Circle = createMaterialSymbolIcon("Circle");
export const CircleAlert = createMaterialSymbolIcon("CircleAlert");
export const CircleAlertFilled = createMaterialSymbolIcon("CircleAlertFilled");
export const CircleCheck = createMaterialSymbolIcon("CircleCheck");
export const CircleDot = createMaterialSymbolIcon("CircleDot");
export const CircleHelpFilled = createMaterialSymbolIcon("CircleHelpFilled");
export const CircleNotificationsFilled = createMaterialSymbolIcon("CircleNotificationsFilled");
export const CircleSlash = createMaterialSymbolIcon("CircleSlash");
export const CircleX = createMaterialSymbolIcon("CircleX");
export const CloseFullscreen = createMaterialSymbolIcon("CloseFullscreen");
export const Clapperboard = createMaterialSymbolIcon("Clapperboard");
export const ClearAll = createMaterialSymbolIcon("ClearAll");
export const ClipboardPaste = createMaterialSymbolIcon("ClipboardPaste");
export const CodeBlocks = createMaterialSymbolIcon("CodeBlocks");
export const Columns2 = createMaterialSymbolIcon("Columns2");
export const Compress = createMaterialSymbolIcon("Compress");
export const ContextualToken = createMaterialSymbolIcon("ContextualToken");
export const Cognition = createMaterialSymbolIcon("Cognition");
export const Copy = createMaterialSymbolIcon("Copy");
export const CopyX = createMaterialSymbolIcon("CopyX");
export const CornerDownLeft = createMaterialSymbolIcon("CornerDownLeft");
export const DataObject = createMaterialSymbolIcon("DataObject");
export const DesignServices = createMaterialSymbolIcon("DesignServices");
export const Devices = createMaterialSymbolIcon("Devices");
export const DocumentSearch = createMaterialSymbolIcon("DocumentSearch");
export const DollarSign = createMaterialSymbolIcon("DollarSign");
export const Download = createMaterialSymbolIcon("Download");
export const EditNote = createMaterialSymbolIcon("EditNote");
export const Error = createMaterialSymbolIcon("Error");
export const Ellipsis = createMaterialSymbolIcon("Ellipsis");
export const EllipsisVertical = createMaterialSymbolIcon("EllipsisVertical");
export const Explore = createMaterialSymbolIcon("Explore");
export const ExploreOff = createMaterialSymbolIcon("ExploreOff");
export const ExternalLink = createMaterialSymbolIcon("ExternalLink");
export const Eye = createMaterialSymbolIcon("Eye");
export const EyeOff = createMaterialSymbolIcon("EyeOff");
export const File = createMaterialSymbolIcon("File");
export const FilePlus = createMaterialSymbolIcon("FilePlus");
export const FileSymlink = createMaterialSymbolIcon("FileSymlink");
export const FileText = createMaterialSymbolIcon("FileText");
export const Files = createMaterialSymbolIcon("Files");
export const FitScreen = createMaterialSymbolIcon("FitScreen");
export const Folder = createMaterialSymbolIcon("Folder");
export const FolderGit2 = createMaterialSymbolIcon("FolderGit2");
export const FolderOpen = createMaterialSymbolIcon("FolderOpen");
export const FolderPlus = createMaterialSymbolIcon("FolderPlus");
export const FolderTree = createMaterialSymbolIcon("FolderTree");
export const FormatAlignCenter = createMaterialSymbolIcon("FormatAlignCenter");
export const FormatBold = createMaterialSymbolIcon("FormatBold");
export const FormatH1 = createMaterialSymbolIcon("FormatH1");
export const FormatH2 = createMaterialSymbolIcon("FormatH2");
export const FormatH3 = createMaterialSymbolIcon("FormatH3");
export const FormatItalic = createMaterialSymbolIcon("FormatItalic");
export const FormatListBulleted = createMaterialSymbolIcon("FormatListBulleted");
export const FormatListNumbered = createMaterialSymbolIcon("FormatListNumbered");
export const FormatQuote = createMaterialSymbolIcon("FormatQuote");
export const FormatStrikethrough = createMaterialSymbolIcon("FormatStrikethrough");
export const Forum = createMaterialSymbolIcon("Forum");
export const Gauge = createMaterialSymbolIcon("Gauge");
export const Gavel = createMaterialSymbolIcon("Gavel");
export const Gift = createMaterialSymbolIcon("Gift");
export const GitBranch = createMaterialSymbolIcon("GitBranch");
export const GitCommitHorizontal = createMaterialSymbolIcon("GitCommitHorizontal");
export const GitMerge = createMaterialSymbolIcon("GitMerge");
export const GitPullRequest = createMaterialSymbolIcon("GitPullRequest");
export const GitPullRequestClosed = createMaterialSymbolIcon("GitPullRequestClosed");
export const GitPullRequestDraft = createMaterialSymbolIcon("GitPullRequestDraft");
export const Github = createMaterialSymbolIcon("Github");
export const Globe = createMaterialSymbolIcon("Globe");
export const Groups = createMaterialSymbolIcon("Groups");
export const Handyman = createMaterialSymbolIcon("Handyman");
export const HardDrive = createMaterialSymbolIcon("HardDrive");
export const Heart = createMaterialSymbolIcon("Heart");
export const HeadsetMic = createMaterialSymbolIcon("HeadsetMic");
export const HeadsetOff = createMaterialSymbolIcon("HeadsetOff");
export const Hexagon = createMaterialSymbolIcon("Hexagon");
export const History = createMaterialSymbolIcon("History");
export const Home = createMaterialSymbolIcon("Home");
export const HorizontalRule = createMaterialSymbolIcon("HorizontalRule");
export const Image = createMaterialSymbolIcon("Image");
export const Import = createMaterialSymbolIcon("Import");
export const Inbox = createMaterialSymbolIcon("Inbox");
export const InboxText = createMaterialSymbolIcon("InboxText");
export const Info = createMaterialSymbolIcon("Info");
export const Keyboard = createMaterialSymbolIcon("Keyboard");
export const Layers = createMaterialSymbolIcon("Layers");
export const Lightbulb = createMaterialSymbolIcon("Lightbulb");
export const Link = createMaterialSymbolIcon("Link");
export const Link2 = createMaterialSymbolIcon("Link2");
export const List = createMaterialSymbolIcon("List");
export const ListChevronsDownUp = createMaterialSymbolIcon("ListChevronsDownUp");
export const ListChevronsUpDown = createMaterialSymbolIcon("ListChevronsUpDown");
export const ListTodo = createMaterialSymbolIcon("ListTodo");
export const LocalPolice = createMaterialSymbolIcon("LocalPolice");
export const MailReceived = createMaterialSymbolIcon("MailReceived");
export const MarkChatUnread = createMaterialSymbolIcon("MarkChatUnread");
export const MarkUnreadChatAlt = createVerticallyNudgedMaterialSymbolIcon("MarkUnreadChatAlt", 1);
export const Maximize = createMaterialSymbolIcon("Maximize");
// Material's `workspace_premium`, filled. The outline weight and `military_tech`
// (the literal ribbon medal) both collapse into an unreadable smudge at the
// 14-16px a table cell gives them; the filled seal keeps its silhouette, and it
// is the fill that lets a gold/silver/bronze tint actually read as a tier.
export const Medal = createMaterialSymbolIcon("Medal");
export const MessageSquare = createMaterialSymbolIcon("MessageSquare");
export const MessageSquareCode = createMaterialSymbolIcon("MessageSquareCode");
export const MessageSquarePlus = createMaterialSymbolIcon("MessageSquarePlus");
export const Mic = createMaterialSymbolIcon("Mic");
export const MicOff = createMaterialSymbolIcon("MicOff");
export const MicVocal = createMaterialSymbolIcon("MicVocal");
export const Minus = createMaterialSymbolIcon("Minus");
export const Monitor = createMaterialSymbolIcon("Monitor");
export const Moon = createMaterialSymbolIcon("Moon");
export const MoreHorizontal = createMaterialSymbolIcon("MoreHorizontal");
export const MoreVertical = createMaterialSymbolIcon("MoreVertical");
export const MousePointer2 = createMaterialSymbolIcon("MousePointer2");
export const Network = createMaterialSymbolIcon("Network");
export const Neurology = createMaterialSymbolIcon("Neurology");
export const OpenInFull = createMaterialSymbolIcon("OpenInFull");
export const PackagePlus = createMaterialSymbolIcon("PackagePlus");
export const Palette = createMaterialSymbolIcon("Palette");
export const PanelLeft = createMaterialSymbolIcon("PanelLeft");
export const PanelLeftClose = createMaterialSymbolIcon("PanelLeftClose");
export const PanelRight = createMaterialSymbolIcon("PanelRight");
export const Paperclip = createMaterialSymbolIcon("Paperclip");
export const Pause = createMaterialSymbolIcon("Pause");
export const Pencil = createMaterialSymbolIcon("Pencil");
export const PictureInPicture = createMaterialSymbolIcon("PictureInPicture");
export const Pilcrow = createMaterialSymbolIcon("Pilcrow");
export const Pin = createMaterialSymbolIcon("Pin");
export const PinFilled = createMaterialSymbolIcon("PinFilled");
export const PinOff = createMaterialSymbolIcon("PinOff");
export const Play = createMaterialSymbolIcon("Play");
export const PlayFilled = createMaterialSymbolIcon("PlayFilled");
export const Plug = createMaterialSymbolIcon("Plug");
export const Plus = createMaterialSymbolIcon("Plus");
export const PrivacyTip = createMaterialSymbolIcon("PrivacyTip");
// Material's `psychology` - a head with a gear in it, for the effort/reasoning/
// thinking controls. NOT `Brain` (`network_intelligence`), which is reserved for
// the Otto Brain feature.
export const Psychology = createMaterialSymbolIcon("Psychology");
export const Puzzle = createMaterialSymbolIcon("Puzzle");
export const QrCode = createMaterialSymbolIcon("QrCode");
export const RecordVoiceOver = createMaterialSymbolIcon("RecordVoiceOver");
export const RefreshCcw = createMaterialSymbolIcon("RefreshCcw");
export const RefreshCw = createMaterialSymbolIcon("RefreshCw");
export const Restart = createMaterialSymbolIcon("Restart");
export const Robot = createMaterialSymbolIcon("Robot");
export const RotateCw = createMaterialSymbolIcon("RotateCw");
export const Rows2 = createMaterialSymbolIcon("Rows2");
export const Save = createMaterialSymbolIcon("Save");
export const Schema = createMaterialSymbolIcon("Schema");
export const Scissors = createMaterialSymbolIcon("Scissors");
export const Search = createMaterialSymbolIcon("Search");
export const Send = createMaterialSymbolIcon("Send");
export const Server = createMaterialSymbolIcon("Server");
export const Settings = createMaterialSymbolIcon("Settings");
export const Siren = createMaterialSymbolIcon("Siren");
export const SirenQuestion = createMaterialSymbolIcon("SirenQuestion");
export const Settings2 = createMaterialSymbolIcon("Settings2");
export const Shield = createMaterialSymbolIcon("Shield");
export const ShieldAlert = createMaterialSymbolIcon("ShieldAlert");
export const ShieldCheck = createMaterialSymbolIcon("ShieldCheck");
export const ShieldOff = createMaterialSymbolIcon("ShieldOff");
export const ShieldPerson = createMaterialSymbolIcon("ShieldPerson");
export const ShieldQuestionMark = createMaterialSymbolIcon("ShieldQuestionMark");
export const ShieldToggle = createMaterialSymbolIcon("ShieldToggle");
export const Smartphone = createMaterialSymbolIcon("Smartphone");
export const Sparkles = createMaterialSymbolIcon("Sparkles");
export const SpeakerNotes = createMaterialSymbolIcon("SpeakerNotes");
export const Split = createMaterialSymbolIcon("Split");
export const Square = createMaterialSymbolIcon("Square");
export const SquarePen = createMaterialSymbolIcon("SquarePen");
export const SquareTerminal = createMaterialSymbolIcon("SquareTerminal");
export const Star = createMaterialSymbolIcon("Star");
export const StarFilled = createMaterialSymbolIcon("StarFilled");
export const Stethoscope = createMaterialSymbolIcon("Stethoscope");
export const Stop = createMaterialSymbolIcon("Stop");
export const Summarize = createMaterialSymbolIcon("Summarize");
export const Sun = createMaterialSymbolIcon("Sun");
export const TableChart = createMaterialSymbolIcon("TableChart");
export const TableRows = createMaterialSymbolIcon("TableRows");
export const Tablet = createMaterialSymbolIcon("Tablet");
export const Tabs = createMaterialSymbolIcon("Tabs");
export const Terminal = createMaterialSymbolIcon("Terminal");
export const TextSelectStart = createMaterialSymbolIcon("TextSelectStart");
export const Timeline = createMaterialSymbolIcon("Timeline");
export const Trash2 = createMaterialSymbolIcon("Trash2");
export const TravelExplore = createMaterialSymbolIcon("TravelExplore");
export const TriangleAlert = createMaterialSymbolIcon("TriangleAlert");
export const Undo2 = createMaterialSymbolIcon("Undo2");
export const Unlink = createMaterialSymbolIcon("Unlink");
export const Upload = createMaterialSymbolIcon("Upload");
export const UploadFile = createMaterialSymbolIcon("UploadFile");
export const ViewColumn = createMaterialSymbolIcon("ViewColumn");
export const VoiceOverOff = createMaterialSymbolIcon("VoiceOverOff");
export const VoiceSelection = createMaterialSymbolIcon("VoiceSelection");
export const VoiceSelectionOff = createMaterialSymbolIcon("VoiceSelectionOff");
export const Volume2 = createMaterialSymbolIcon("Volume2");
export const VolumeX = createMaterialSymbolIcon("VolumeX");
export const WandStars = createMaterialSymbolIcon("WandStars");
export const Waypoints = createMaterialSymbolIcon("Waypoints");
export const Workspaces = createMaterialSymbolIcon("Workspaces");
export const WrapText = createMaterialSymbolIcon("WrapText");
export const Wrench = createMaterialSymbolIcon("Wrench");
export const Wysiwyg = createMaterialSymbolIcon("Wysiwyg");
export const Visibility = createMaterialSymbolIcon("Visibility");
export const X = createMaterialSymbolIcon("X");
export const XCircle = createMaterialSymbolIcon("XCircle");
export const Zap = createMaterialSymbolIcon("Zap");

// lucide-react-native exported both `TriangleAlert` and the alias `TriangleAlertIcon`.
export const TriangleAlertIcon = TriangleAlert;

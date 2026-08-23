import * as Lucide from "lucide-react-native";
import { withIconSizeToken } from "@/components/icons/icon-size";

/**
 * The lucide set, wrapped so it speaks the app's size tokens.
 *
 * Import lucide glyphs from here, never from `lucide-react-native` directly. Lucide types
 * its own `size` as `string | number`, so a token handed to a raw lucide icon type-checks
 * and then renders at lucide's default 24 - a silent, compile-clean way to get one icon in
 * a row at the wrong size. Routing the set through the same wrapper the Material icons use
 * makes that impossible and gives lucide glyphs the compact ladder for free.
 *
 * See `material-icons.ts` for the equivalent barrel over the Material Symbols set.
 */
export const Activity = withIconSizeToken(Lucide.Activity, "Activity");
export const AlertTriangle = withIconSizeToken(Lucide.AlertTriangle, "AlertTriangle");
export const Archive = withIconSizeToken(Lucide.Archive, "Archive");
export const ArrowDownUp = withIconSizeToken(Lucide.ArrowDownUp, "ArrowDownUp");
export const ArrowLeft = withIconSizeToken(Lucide.ArrowLeft, "ArrowLeft");
export const ArrowLeftToLine = withIconSizeToken(Lucide.ArrowLeftToLine, "ArrowLeftToLine");
export const BookOpen = withIconSizeToken(Lucide.BookOpen, "BookOpen");
export const Bot = withIconSizeToken(Lucide.Bot, "Bot");
export const Boxes = withIconSizeToken(Lucide.Boxes, "Boxes");
export const Brain = withIconSizeToken(Lucide.Brain, "Brain");
export const Bug = withIconSizeToken(Lucide.Bug, "Bug");
export const CalendarClock = withIconSizeToken(Lucide.CalendarClock, "CalendarClock");
export const Captions = withIconSizeToken(Lucide.Captions, "Captions");
export const Check = withIconSizeToken(Lucide.Check, "Check");
export const CheckCircle = withIconSizeToken(Lucide.CheckCircle, "CheckCircle");
export const ChevronDown = withIconSizeToken(Lucide.ChevronDown, "ChevronDown");
export const ChevronRight = withIconSizeToken(Lucide.ChevronRight, "ChevronRight");
export const ChevronUp = withIconSizeToken(Lucide.ChevronUp, "ChevronUp");
export const Circle = withIconSizeToken(Lucide.Circle, "Circle");
export const CircleCheck = withIconSizeToken(Lucide.CircleCheck, "CircleCheck");
export const CircleDashed = withIconSizeToken(Lucide.CircleDashed, "CircleDashed");
export const CircleDot = withIconSizeToken(Lucide.CircleDot, "CircleDot");
export const CircleHelp = withIconSizeToken(Lucide.CircleHelp, "CircleHelp");
export const Clock = withIconSizeToken(Lucide.Clock, "Clock");
export const Cloud = withIconSizeToken(Lucide.Cloud, "Cloud");
export const Code = withIconSizeToken(Lucide.Code, "Code");
export const Columns2 = withIconSizeToken(Lucide.Columns2, "Columns2");
export const Compass = withIconSizeToken(Lucide.Compass, "Compass");
export const Copy = withIconSizeToken(Lucide.Copy, "Copy");
export const CopyPlus = withIconSizeToken(Lucide.CopyPlus, "CopyPlus");
export const Cpu = withIconSizeToken(Lucide.Cpu, "Cpu");
export const Database = withIconSizeToken(Lucide.Database, "Database");
export const Diff = withIconSizeToken(Lucide.Diff, "Diff");
export const Download = withIconSizeToken(Lucide.Download, "Download");
export const ExternalLink = withIconSizeToken(Lucide.ExternalLink, "ExternalLink");
export const Eye = withIconSizeToken(Lucide.Eye, "Eye");
export const EyeOff = withIconSizeToken(Lucide.EyeOff, "EyeOff");
export const Feather = withIconSizeToken(Lucide.Feather, "Feather");
export const FilePlus = withIconSizeToken(Lucide.FilePlus, "FilePlus");
export const FileText = withIconSizeToken(Lucide.FileText, "FileText");
export const FileWarning = withIconSizeToken(Lucide.FileWarning, "FileWarning");
export const FlaskConical = withIconSizeToken(Lucide.FlaskConical, "FlaskConical");
export const Folder = withIconSizeToken(Lucide.Folder, "Folder");
export const FolderMinus = withIconSizeToken(Lucide.FolderMinus, "FolderMinus");
export const FolderOpen = withIconSizeToken(Lucide.FolderOpen, "FolderOpen");
export const FolderPlus = withIconSizeToken(Lucide.FolderPlus, "FolderPlus");
export const Gift = withIconSizeToken(Lucide.Gift, "Gift");
export const GitBranch = withIconSizeToken(Lucide.GitBranch, "GitBranch");
export const GitCommitHorizontal = withIconSizeToken(
  Lucide.GitCommitHorizontal,
  "GitCommitHorizontal",
);
export const GitMerge = withIconSizeToken(Lucide.GitMerge, "GitMerge");
export const GitPullRequest = withIconSizeToken(Lucide.GitPullRequest, "GitPullRequest");
export const GitPullRequestClosed = withIconSizeToken(
  Lucide.GitPullRequestClosed,
  "GitPullRequestClosed",
);
export const Github = withIconSizeToken(Lucide.Github, "Github");
export const Globe = withIconSizeToken(Lucide.Globe, "Globe");
export const Hammer = withIconSizeToken(Lucide.Hammer, "Hammer");
export const HardDrive = withIconSizeToken(Lucide.HardDrive, "HardDrive");
export const History = withIconSizeToken(Lucide.History, "History");
export const Home = withIconSizeToken(Lucide.Home, "Home");
export const Info = withIconSizeToken(Lucide.Info, "Info");
export const Keyboard = withIconSizeToken(Lucide.Keyboard, "Keyboard");
export const KeyboardOff = withIconSizeToken(Lucide.KeyboardOff, "KeyboardOff");
export const Layers = withIconSizeToken(Lucide.Layers, "Layers");
export const MessageCircle = withIconSizeToken(Lucide.MessageCircle, "MessageCircle");
export const MessageSquarePlus = withIconSizeToken(Lucide.MessageSquarePlus, "MessageSquarePlus");
export const Microscope = withIconSizeToken(Lucide.Microscope, "Microscope");
export const MoreHorizontal = withIconSizeToken(Lucide.MoreHorizontal, "MoreHorizontal");
export const MoreVertical = withIconSizeToken(Lucide.MoreVertical, "MoreVertical");
export const Network = withIconSizeToken(Lucide.Network, "Network");
export const Package = withIconSizeToken(Lucide.Package, "Package");
export const Palette = withIconSizeToken(Lucide.Palette, "Palette");
export const Pause = withIconSizeToken(Lucide.Pause, "Pause");
export const Pencil = withIconSizeToken(Lucide.Pencil, "Pencil");
export const Play = withIconSizeToken(Lucide.Play, "Play");
export const Plus = withIconSizeToken(Lucide.Plus, "Plus");
export const RefreshCcw = withIconSizeToken(Lucide.RefreshCcw, "RefreshCcw");
export const Rocket = withIconSizeToken(Lucide.Rocket, "Rocket");
export const RotateCw = withIconSizeToken(Lucide.RotateCw, "RotateCw");
export const Rows2 = withIconSizeToken(Lucide.Rows2, "Rows2");
export const Scan = withIconSizeToken(Lucide.Scan, "Scan");
export const Search = withIconSizeToken(Lucide.Search, "Search");
export const Server = withIconSizeToken(Lucide.Server, "Server");
export const Settings = withIconSizeToken(Lucide.Settings, "Settings");
export const Settings2 = withIconSizeToken(Lucide.Settings2, "Settings2");
export const Shield = withIconSizeToken(Lucide.Shield, "Shield");
export const ShieldCheck = withIconSizeToken(Lucide.ShieldCheck, "ShieldCheck");
export const Sparkles = withIconSizeToken(Lucide.Sparkles, "Sparkles");
export const SquareMinus = withIconSizeToken(Lucide.SquareMinus, "SquareMinus");
export const SquarePen = withIconSizeToken(Lucide.SquarePen, "SquarePen");
export const SquarePlus = withIconSizeToken(Lucide.SquarePlus, "SquarePlus");
export const SquareTerminal = withIconSizeToken(Lucide.SquareTerminal, "SquareTerminal");
export const Terminal = withIconSizeToken(Lucide.Terminal, "Terminal");
export const TestTube = withIconSizeToken(Lucide.TestTube, "TestTube");
export const Trash2 = withIconSizeToken(Lucide.Trash2, "Trash2");
export const Type = withIconSizeToken(Lucide.Type, "Type");
export const Undo2 = withIconSizeToken(Lucide.Undo2, "Undo2");
export const Upload = withIconSizeToken(Lucide.Upload, "Upload");
export const Workflow = withIconSizeToken(Lucide.Workflow, "Workflow");
export const Wrench = withIconSizeToken(Lucide.Wrench, "Wrench");
export const X = withIconSizeToken(Lucide.X, "X");
export const ZoomIn = withIconSizeToken(Lucide.ZoomIn, "ZoomIn");
export const ZoomOut = withIconSizeToken(Lucide.ZoomOut, "ZoomOut");

export type { LucideIcon } from "lucide-react-native";

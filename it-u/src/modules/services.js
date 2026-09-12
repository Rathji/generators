// src/modules/services.js — the Services station (email, backup, network,
// security, virtualization, voice and resold internet; roadmap tasks 31-40).
import { icons } from "../framework/icons.js";
import { createStation } from "./station.js";

export default createStation({
  id: "services",
  label: "Services",
  desc: "The client's delivered services — email, backup, network, security, virtualization, voice and resold internet.",
  icon: icons.layers,
  capabilities: [
    "Email system",
    "Backup and recovery",
    "Internet/WAN, LAN and wireless network",
    "Security, remote access, virtualization, file sharing and printing",
    "Voice/PBX and resold internet/ISP circuits",
  ],
  emptyDesc:
    "Each delivered service — its platform, related configurations, vendors and documentation — will be modelled here.",
});

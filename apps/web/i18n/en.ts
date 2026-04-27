const en = {
  common: {
    close: "Close",
    cancel: "Cancel",
    apply: "Apply",
    search: "Search",
    save: "Save",
    loading: "Loading..."
  },
  shell: {
    nav: {
      dashboard: "Dashboard",
      templates: "Templates",
      lists: "Lists",
      segments: "Segments",
      send: "Send",
      campaigns: "Campaigns",
      smtp: "SMTP",
      suppression: "Suppression",
      logs: "Logs"
    },
    language: "Language",
    logout: "Logout"
  },
  empty: {
    backendRequired: "Backend endpoint is required for this action"
  },
  send: {
    bootstrapFailedTitle: "Failed to load send setup data.",
    bootstrapFailedBody: "Please refresh the page and try again.",
    templateRequiredTitle: "Template is required",
    templateRequiredBody: "Select a template before starting a campaign.",
    targetRequiredTitle: "Target is required",
    targetRequiredBody: "Select a list, segment, or ad-hoc condition.",
    targetZeroTitle: "Target count is zero",
    targetZeroBody: "No usable recipients were found for the selected target.",
    smtpRequiredTitle: "No usable SMTP pool",
    smtpRequiredBody: "At least one active and healthy SMTP account is required."
  },
  smtp: {
    deleteFailed: "SMTP could not be deleted.",
    operationFailed: "Operation failed.",
    saveFailed: "SMTP could not be saved.",
    connectionTestFailed: "SMTP connection test failed.",
    connectionTestSuccess: "SMTP connection test succeeded."
  },
  templates: {
    listLoadFailed: "Template library could not be loaded.",
    createFailed: "Template could not be created.",
    saveFailed: "Template could not be saved.",
    deleteFailed: "Template could not be deleted.",
    detailFailed: "Template details could not be loaded."
  },
  lists: {
    summaryLoadFailed: "List summary could not be loaded.",
    createFailed: "List could not be created.",
    updateFailed: "List could not be updated.",
    deleteFailed: "List could not be deleted.",
    importFailed: "Bulk import failed.",
    removeFailed: "Bulk remove failed.",
    searchFailed: "Search failed."
  }
} as const;

export default en;

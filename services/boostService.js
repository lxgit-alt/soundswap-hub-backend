export const isProfileHighlightActive = (user) => {
    const highlight = user.boosts?.profileHighlight;
    if (!highlight) return false;
  
    const now = new Date();
    const expiresAt = highlight.expiresAt.toDate(); // Convert Firestore Timestamp
    return expiresAt > now;
  };

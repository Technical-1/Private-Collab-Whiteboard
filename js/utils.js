// 20 Easy-to-Read Colors (same as original)
export const colors = [
  "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD",
  "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF",
  "#393B79", "#637939", "#8C6D31", "#843C39", "#7B4173",
  "#3182BD", "#6BAED6", "#9E9AC8", "#B5CF6B", "#E6550D"
];

// Generate a unique ID for drawings
export function generateId() {
  return crypto.randomUUID();
}

// Generate a user ID (persisted in localStorage)
export function generateUserId() {
  let userId = localStorage.getItem('whiteboard-user-id');
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem('whiteboard-user-id', userId);
  }
  return userId;
}

// Assign a color deterministically based on user ID
export function assignColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash = hash & hash;
  }
  return colors[Math.abs(hash) % colors.length];
}

// Generate a room ID (16 hex chars)
export function generateRoomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

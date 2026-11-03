
async function adminRequest(action, data = {}) {
  if (!auth.currentUser) {
    throw new Error("Please login again.");
  }

  const token = await auth.currentUser.getIdToken();

  const response = await fetch("/.netlify/functions/admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ action, ...data })
  });

  const raw = await response.text();

  let result;

  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(
      `Server Error (HTTP ${response.status}): ${raw.slice(0, 200)}`
    );
  }

  if (!response.ok) {
    throw new Error(result.error || "Admin request failed");
  }

  return result;
}

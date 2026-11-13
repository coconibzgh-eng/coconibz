import "./supabase-client.js";

const backend = window.coconibzBackend;
const message = document.querySelector("#account-message");
const ordersMessage = document.querySelector("#orders-message");
const authPanel = document.querySelector("#auth-panel");
const accountPanel = document.querySelector("#account-panel");
const staffAccessNote = document.querySelector("#staff-access-note");
const signupForm = document.querySelector("#signup-form");
const loginForm = document.querySelector("#login-form");
const rememberedPhoneList = document.querySelector("#remembered-phones");
const rememberLoginCheckbox = document.querySelector("#remember-login");
const clearRememberedPhonesButton = document.querySelector("#clear-remembered-phones");
const otpForm = document.querySelector("#otp-form");
const accountRetailerInviteForm = document.querySelector("#account-retailer-invite-form");
const resendOtpButton = document.querySelector("#resend-otp-button");
const ordersBody = document.querySelector("#orders-body");
const loadMoreButton = document.querySelector("#load-more-orders");
const profilePhotoForm = document.querySelector("#profile-photo-form");
const profilePhotoInput = document.querySelector("#profile-photo");
const profilePhotoImage = document.querySelector("#account-avatar");
const profilePhotoMessage = document.querySelector("#profile-photo-message");
const passwordChangeForm = document.querySelector("#password-change-form");
const passwordChangeMessage = document.querySelector("#password-change-message");
const editOrderDialog = document.querySelector("#edit-order-dialog");
const editOrderForm = document.querySelector("#edit-order-form");
const editOrderFulfillment = document.querySelector("#edit-order-fulfillment");
const editOrderPickupFields = document.querySelector("#edit-order-pickup-fields");
const editOrderShop = document.querySelector("#edit-order-shop");
const editOrderDeliveryFields = document.querySelector("#edit-order-delivery-fields");
const editOrderDeliveryArea = document.querySelector("#edit-order-delivery-area");
const editOrderDeliveryAddress = document.querySelector("#edit-order-delivery-address");
const editOrderMessage = document.querySelector("#edit-order-message");
const editOrderTotal = document.querySelector("#edit-order-total");
const editOrderQuantities = {
  classic: document.querySelector("#edit-order-classic"),
  dates: document.querySelector("#edit-order-dates"),
  tigernut: document.querySelector("#edit-order-tigernut"),
};
const pageSize = 100;
const rememberedPhonesKey = "coconibz-remembered-phone-numbers";
let orderOffset = 0;
let allOrders = [];
let orderShops = null;
let editingOrder = null;
let hasMoreOrders = true;
let currentSession = null;
let currentProfile = null;
let requestedNext = new URLSearchParams(window.location.search).get("next");
let pendingPhone = "";
let pendingRetailerCode = "";

staffAccessNote.hidden = !["operations.html", "admin.html"].includes(requestedNext);

function normalizePhone(phone) {
  return phone.replace(/[()\s-]/g, "");
}

function getRememberedPhones() {
  const savedPhones = window.localStorage.getItem(rememberedPhonesKey);
  if (savedPhones === null) return [];
  let parsedPhones;
  try {
    parsedPhones = JSON.parse(savedPhones);
  } catch {
    throw new Error("The remembered phone list is unreadable. Clear saved numbers and try again.");
  }
  if (!Array.isArray(parsedPhones)) {
    throw new Error("The remembered phone list is invalid. Clear saved numbers and try again.");
  }
  const phones = parsedPhones.map((phone) => {
    if (typeof phone !== "string") throw new Error("The remembered phone list is invalid. Clear saved numbers and try again.");
    const normalized = normalizePhone(phone);
    if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) {
      throw new Error("The remembered phone list contains an invalid entry. Clear saved numbers and try again.");
    }
    return normalized;
  });
  return [...new Set(phones)];
}

function renderRememberedPhones() {
  const phones = getRememberedPhones();
  rememberedPhoneList.replaceChildren();
  phones.forEach((phone) => {
    const option = document.createElement("option");
    option.value = phone;
    rememberedPhoneList.append(option);
  });
  clearRememberedPhonesButton.disabled = phones.length === 0;
}

function rememberPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) {
    throw new Error("Enter a phone number in international format before saving it.");
  }
  const phones = getRememberedPhones().filter((savedPhone) => savedPhone !== normalized);
  window.localStorage.setItem(rememberedPhonesKey, JSON.stringify([normalized, ...phones]));
  renderRememberedPhones();
}

function formatGhs(amount) {
  return `GHS ${amount}`;
}

function setOrdersMessage(text, isError = false) {
  ordersMessage.textContent = text;
  ordersMessage.classList.toggle("is-error", isError);
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("is-error", isError);
}

function getSafeNextUrl() {
  if (!requestedNext) return null;
  const target = new URL(requestedNext, window.location.href);
  return target.origin === window.location.origin ? target.href : null;
}

function continueAfterAuth() {
  const target = getSafeNextUrl();
  if (target) {
    window.location.replace(target);
    return true;
  }
  return false;
}

function setBusy(form, isBusy) {
  form.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy;
  });
}

async function getProfile(userId) {
  const { data, error } = await backend.client
    .from("profiles")
    .select("full_name, role, avatar_path")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

function setInlineMessage(target, text, isError = false) {
  target.textContent = text;
  target.classList.toggle("is-error", isError);
}

async function showProfilePhoto(path) {
  if (!path) {
    profilePhotoImage.removeAttribute("src");
    profilePhotoImage.hidden = true;
    return;
  }
  const { data, error } = await backend.client.storage
    .from("profile-photos")
    .createSignedUrl(path, 3600);
  if (error) throw error;
  profilePhotoImage.src = data.signedUrl;
  profilePhotoImage.hidden = false;
}

async function showSignedInAccount(session) {
  currentSession = session;
  if (!session) {
    currentProfile = null;
    authPanel.hidden = false;
    accountPanel.hidden = true;
    signupForm.hidden = false;
    loginForm.hidden = false;
    otpForm.hidden = true;
    profilePhotoImage.removeAttribute("src");
    profilePhotoImage.hidden = true;
    return;
  }

  const profile = await getProfile(session.user.id);
  currentProfile = profile;
  authPanel.hidden = true;
  accountPanel.hidden = false;
  document.querySelector("#account-welcome").textContent = `Hello, ${profile.full_name || "Coconibz customer"}`;
  const portalLink = document.querySelector("#admin-portal-link");
  portalLink.hidden = !["admin", "retailer"].includes(profile.role);
  portalLink.href = "operations.html";
  accountRetailerInviteForm.hidden = profile.role !== "customer";
  if (continueAfterAuth()) return;
  await showProfilePhoto(profile.avatar_path);
  if (window.location.hash === "#account-settings") {
    document.querySelector("#account-settings").scrollIntoView();
  }
  await loadOrders(true);
}

async function completeSignup(session) {
  if (pendingRetailerCode) {
    const retailerCode = pendingRetailerCode;
    pendingRetailerCode = "";
    let inviteError = null;
    try {
      const { error } = await backend.client.rpc("coconibz_redeem_retailer_invite", {
        p_code: retailerCode,
      });
      inviteError = error;
    } catch (error) {
      inviteError = error;
    }
    if (inviteError) {
      requestedNext = null;
      await showSignedInAccount(session);
      document.querySelector("#account-retailer-code").value = retailerCode;
      showMessage(`Your account was created, but retailer access was not granted: ${inviteError.message}. Check the code or contact your admin.`, true);
      return;
    }
    showMessage("Retailer access granted. Your account is ready.");
  } else {
    showMessage("Your account is ready.");
  }
  await showSignedInAccount(session);
}

async function loadOrders(reset = false) {
  if (reset) {
    orderOffset = 0;
    allOrders = [];
    hasMoreOrders = true;
  }
  if (!hasMoreOrders) return;

  setOrdersMessage("Loading your orders...");
  loadMoreButton.disabled = true;
  const { data, error } = await backend.client
    .from("orders")
    .select("id, shop_id, fulfillment, delivery_area, delivery_address, status, financial_status, subtotal, delivery_fee, total, created_at, shops(name), order_items(product_key, flavor, quantity, unit_price, line_total)")
    .order("created_at", { ascending: false })
    .range(orderOffset, orderOffset + pageSize - 1);

  if (error) {
    setOrdersMessage(`Could not load your orders: ${error.message}`, true);
    loadMoreButton.disabled = false;
    return;
  }

  allOrders.push(...data);
  orderOffset += data.length;
  hasMoreOrders = data.length === pageSize;
  loadMoreButton.hidden = !hasMoreOrders;
  loadMoreButton.disabled = false;
  renderOrders();
}

function renderOrders() {
  const startDate = document.querySelector("#filter-start").value;
  const endDate = document.querySelector("#filter-end").value;
  const flavor = document.querySelector("#filter-flavor").value;
  const sort = document.querySelector("#order-sort").value;
  const filteredOrders = allOrders.filter((order) => {
    const orderDate = order.created_at.slice(0, 10);
    return (!startDate || orderDate >= startDate)
      && (!endDate || orderDate <= endDate)
      && (!flavor || order.order_items.some((item) => item.product_key === flavor));
  });

  filteredOrders.sort((first, second) => {
    if (sort === "flavor") {
      const firstFlavor = first.order_items.map((item) => item.flavor).sort()[0] || "";
      const secondFlavor = second.order_items.map((item) => item.flavor).sort()[0] || "";
      return firstFlavor.localeCompare(secondFlavor);
    }
    const comparison = new Date(first.created_at) - new Date(second.created_at);
    return sort === "oldest" ? comparison : -comparison;
  });

  ordersBody.replaceChildren();
  filteredOrders.forEach((order) => {
    const row = document.createElement("tr");
    const date = document.createElement("td");
    const shop = document.createElement("td");
    const flavors = document.createElement("td");
    const total = document.createElement("td");
    const status = document.createElement("td");
    const actions = document.createElement("td");

    date.textContent = new Date(order.created_at).toLocaleString();
    shop.textContent = order.fulfillment === "delivery"
      ? `Delivery · ${order.delivery_area}`
      : order.shops?.name || "Shop to be confirmed";
    flavors.textContent = order.order_items
      .map((item) => `${item.flavor} × ${item.quantity}`)
      .join(", ");
    total.textContent = formatGhs(order.total);
    const statusBadge = document.createElement("span");
    statusBadge.className = `order-status status-${order.status}`;
    statusBadge.textContent = order.status;
    status.append(statusBadge);
    if (currentProfile?.role === "customer" && order.status === "pending" && order.financial_status === "pending") {
      const actionButtons = document.createElement("div");
      actionButtons.className = "order-action-buttons";
      const editButton = document.createElement("button");
      editButton.className = "order-action-button";
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.setAttribute("aria-label", `Edit order placed ${new Date(order.created_at).toLocaleString()}`);
      editButton.addEventListener("click", () => openEditOrder(order));
      const cancelButton = document.createElement("button");
      cancelButton.className = "order-action-button order-action-button-cancel";
      cancelButton.type = "button";
      cancelButton.textContent = "Cancel";
      cancelButton.setAttribute("aria-label", `Cancel order placed ${new Date(order.created_at).toLocaleString()}`);
      cancelButton.addEventListener("click", () => cancelOrder(order, cancelButton));
      actionButtons.append(editButton, cancelButton);
      actions.append(actionButtons);
    } else if (currentProfile?.role === "customer" && order.status === "pending") {
      actions.textContent = "Contact COCONIBZ";
    } else {
      actions.textContent = "—";
    }
    row.append(date, shop, flavors, total, status, actions);
    ordersBody.append(row);
  });

  setOrdersMessage(filteredOrders.length
    ? `Showing ${filteredOrders.length} of ${allOrders.length} loaded orders${hasMoreOrders ? ". Load more to include older orders in the filters." : "."}`
    : allOrders.length
      ? "No orders match these filters."
      : "No saved order requests yet. Select your flavors and order to get started.");
}

async function loadOrderShops() {
  if (orderShops) return orderShops;
  const { data, error } = await backend.client
    .from("shops")
    .select("id, name")
    .order("name");
  if (error) throw error;
  orderShops = data;
  return orderShops;
}

function updateEditOrderFields() {
  const isDelivery = editOrderFulfillment.value === "delivery";
  editOrderPickupFields.hidden = isDelivery;
  editOrderDeliveryFields.hidden = !isDelivery;
  editOrderShop.required = !isDelivery;
  editOrderDeliveryArea.required = isDelivery;
  editOrderDeliveryAddress.required = isDelivery;

  const subtotal = Object.values(editOrderQuantities)
    .reduce((sum, input) => sum + Number(input.value || 0) * 12, 0);
  const deliveryFee = isDelivery
    ? Number(editOrderDeliveryArea.selectedOptions[0]?.dataset.fee || 0)
    : 0;
  editOrderTotal.textContent = `Subtotal: ${formatGhs(subtotal)} · Delivery: ${formatGhs(deliveryFee)} · Total: ${formatGhs(subtotal + deliveryFee)}`;
}

async function openEditOrder(order) {
  if (order.status !== "pending") {
    setOrdersMessage("Only pending orders can be edited.", true);
    return;
  }
  try {
    const shops = await loadOrderShops();
    editOrderShop.replaceChildren(
      new Option("Choose a pickup shop", ""),
      ...shops.map((shop) => new Option(shop.name, shop.id))
    );
    editingOrder = order;
    editOrderFulfillment.value = order.fulfillment;
    editOrderShop.value = order.shop_id || "";
    editOrderDeliveryArea.value = order.delivery_area || "";
    editOrderDeliveryAddress.value = order.delivery_address || "";
    Object.entries(editOrderQuantities).forEach(([productKey, input]) => {
      const item = order.order_items.find((orderItem) => orderItem.product_key === productKey);
      input.value = String(item?.quantity || 0);
    });
    editOrderMessage.textContent = "";
    editOrderMessage.classList.remove("is-error");
    updateEditOrderFields();
    editOrderDialog.showModal();
    editOrderFulfillment.focus();
  } catch (error) {
    setOrdersMessage(`Could not open the order editor: ${error.message}`, true);
  }
}

async function cancelOrder(order, button) {
  if (!window.confirm("Cancel this pending order? This cannot be undone.")) return;
  button.disabled = true;
  setOrdersMessage("Cancelling your order...");
  try {
    const { error } = await backend.client.rpc("coconibz_customer_cancel_order", {
      p_order_id: order.id,
    });
    if (error) throw error;
    await loadOrders(true);
    if (!ordersMessage.classList.contains("is-error")) {
      setOrdersMessage("Your order was cancelled.");
    }
  } catch (error) {
    setOrdersMessage(`Could not cancel your order: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(signupForm, true);
  showMessage("Creating your account...");
  const formData = new FormData(signupForm);
  pendingPhone = normalizePhone(String(formData.get("phone")));
  pendingRetailerCode = String(formData.get("retailer_code") || "").trim();

  try {
    const { data, error } = await backend.client.auth.signUp({
      phone: pendingPhone,
      password: String(formData.get("password")),
      options: { data: { full_name: String(formData.get("full_name")).trim() } },
    });
    if (error) throw error;
    if (data.session) {
      await completeSignup(data.session);
      return;
    }

    document.querySelector("#otp-phone-label").textContent = pendingPhone;
    signupForm.hidden = true;
    loginForm.hidden = true;
    otpForm.hidden = false;
    showMessage("Enter the SMS code to verify your phone.");
  } catch (error) {
    pendingRetailerCode = "";
    showMessage(`Could not create your account: ${error.message}`, true);
    setBusy(signupForm, false);
  }
});

otpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(otpForm, true);
  showMessage("Verifying your phone...");
  const token = String(new FormData(otpForm).get("token")).trim();

  try {
    const { data, error } = await backend.client.auth.verifyOtp({
      phone: pendingPhone,
      token,
      type: "sms",
    });
    if (error) throw error;
    await completeSignup(data.session);
  } catch (error) {
    showMessage(`Could not verify the code: ${error.message}`, true);
    setBusy(otpForm, false);
  }
});

accountRetailerInviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(accountRetailerInviteForm, true);
  showMessage("Redeeming retailer code...");
  const formData = new FormData(accountRetailerInviteForm);
  const code = String(formData.get("retailer_code")).trim();

  try {
    const { error } = await backend.client.rpc("coconibz_redeem_retailer_invite", {
      p_code: code,
    });
    if (error) throw error;
    showMessage("Retailer access granted.");
    await showSignedInAccount(currentSession);
  } catch (error) {
    showMessage(`Could not redeem retailer code: ${error.message}`, true);
    setBusy(accountRetailerInviteForm, false);
  }
});

resendOtpButton.addEventListener("click", async () => {
  setBusy(otpForm, true);
  showMessage("Requesting another verification code...");

  try {
    const { error } = await backend.client.auth.resend({
      type: "sms",
      phone: pendingPhone,
    });
    if (error) throw error;
    showMessage("A new verification code was requested. Check your SMS messages.");
  } catch (error) {
    showMessage(`Could not resend the verification code: ${error.message}`, true);
  } finally {
    setBusy(otpForm, false);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(loginForm, true);
  showMessage("Signing you in...");
  const formData = new FormData(loginForm);
  const phone = normalizePhone(String(formData.get("phone")));

  try {
    const { data, error } = await backend.client.auth.signInWithPassword({
      phone,
      password: String(formData.get("password")),
    });
    if (error) throw error;
    let rememberError = null;
    if (rememberLoginCheckbox.checked) {
      try {
        rememberPhone(phone);
      } catch (error) {
        rememberError = error;
        requestedNext = null;
      }
    }
    await showSignedInAccount(data.session);
    if (rememberError) {
      showMessage(`Signed in, but this browser could not save the phone number: ${rememberError.message}`, true);
    }
  } catch (error) {
    showMessage(`Could not sign in: ${error.message}`, true);
    setBusy(loginForm, false);
  }
});

clearRememberedPhonesButton.addEventListener("click", () => {
  if (!window.confirm("Clear all remembered phone numbers from this browser?")) return;
  try {
    window.localStorage.removeItem(rememberedPhonesKey);
    renderRememberedPhones();
    showMessage("Remembered phone numbers cleared from this browser.");
  } catch (error) {
    showMessage(`Could not clear remembered phone numbers: ${error.message}`, true);
  }
});

profilePhotoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(profilePhotoForm, true);
  setInlineMessage(profilePhotoMessage, "");
  const file = profilePhotoInput.files[0];
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

  try {
    if (!currentSession || !currentProfile) throw new Error("Sign in again before uploading a profile photo.");
    if (!file || !extensions[file.type]) throw new Error("Choose a JPG, PNG, or WebP image.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Profile photos must be 5 MB or smaller.");

    const newPath = `${currentSession.user.id}/${crypto.randomUUID()}.${extensions[file.type]}`;
    const { error: uploadError } = await backend.client.storage
      .from("profile-photos")
      .upload(newPath, file, { cacheControl: "3600", contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const oldPath = currentProfile.avatar_path;
    const { error: updateError } = await backend.client
      .from("profiles")
      .update({ avatar_path: newPath })
      .eq("id", currentSession.user.id);
    if (updateError) {
      const { error: cleanupError } = await backend.client.storage.from("profile-photos").remove([newPath]);
      if (cleanupError) {
        throw new Error(`Could not save your profile photo: ${updateError.message}. Temporary file cleanup also failed: ${cleanupError.message}`);
      }
      throw updateError;
    }

    currentProfile.avatar_path = newPath;
    let displayError = null;
    try {
      await showProfilePhoto(newPath);
    } catch (error) {
      displayError = error;
    }
    profilePhotoForm.reset();
    if (oldPath) {
      const { error: removeError } = await backend.client.storage.from("profile-photos").remove([oldPath]);
      if (removeError) {
        setInlineMessage(profilePhotoMessage, `Photo updated, but the previous image could not be removed: ${removeError.message}`, true);
        return;
      }
    }
    if (displayError) {
      setInlineMessage(profilePhotoMessage, `Photo updated, but its preview could not be loaded: ${displayError.message}`, true);
      return;
    }
    setInlineMessage(profilePhotoMessage, "Profile photo updated.");
  } catch (error) {
    setInlineMessage(profilePhotoMessage, `Could not update your profile photo: ${error.message}`, true);
  } finally {
    setBusy(profilePhotoForm, false);
  }
});

passwordChangeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(passwordChangeForm, true);
  setInlineMessage(passwordChangeMessage, "");
  const formData = new FormData(passwordChangeForm);
  const currentPassword = String(formData.get("current_password"));
  const newPassword = String(formData.get("new_password"));

  try {
    if (!currentSession?.user.phone) throw new Error("Your signed-in account does not have a phone number for password verification.");
    if (newPassword !== String(formData.get("confirm_password"))) throw new Error("The new passwords do not match.");
    if (newPassword.length < 8) throw new Error("The new password must be at least 8 characters.");

    const { error: verifyError } = await backend.client.auth.signInWithPassword({
      phone: normalizePhone(currentSession.user.phone),
      password: currentPassword,
    });
    if (verifyError) throw new Error(`Current password was not verified: ${verifyError.message}`);

    const { error: updateError } = await backend.client.auth.updateUser({ password: newPassword });
    if (updateError) throw updateError;

    const { error: signOutError } = await backend.client.auth.signOut({ scope: "global" });
    let localSignOutError = null;
    if (signOutError) {
      const { error } = await backend.client.auth.signOut({ scope: "local" });
      localSignOutError = error;
    }
    requestedNext = null;
    await showSignedInAccount(null);
    passwordChangeForm.reset();
    if (signOutError) {
      showMessage(
        `Password updated, but other sessions could not be revoked: ${signOutError.message}.${localSignOutError ? ` This device could not be signed out: ${localSignOutError.message}.` : " This device has been signed out."} Sign out other devices manually.`,
        true
      );
      return;
    }
    showMessage("Password updated. You have been signed out on all devices; sign in again with your new password.");
  } catch (error) {
    setInlineMessage(passwordChangeMessage, `Could not update your password: ${error.message}`, true);
  } finally {
    setBusy(passwordChangeForm, false);
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  const { error } = await backend.client.auth.signOut();
  if (error) {
    showMessage(`Could not log out: ${error.message}`, true);
    return;
  }
  requestedNext = null;
  showMessage("You have been logged out.");
  await showSignedInAccount(null);
});

editOrderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingOrder) return;
  setBusy(editOrderForm, true);
  setInlineMessage(editOrderMessage, "");

  try {
    const items = Object.entries(editOrderQuantities)
      .map(([productKey, input]) => ({ product_key: productKey, quantity: Number(input.value) }))
      .filter((item) => item.quantity > 0);
    if (!items.length) throw new Error("Keep at least one flavor in your order.");
    if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity > 20)) {
      throw new Error("Each flavor quantity must be a whole number between 1 and 20.");
    }

    const isDelivery = editOrderFulfillment.value === "delivery";
    const { error } = await backend.client.rpc("coconibz_customer_update_order", {
      p_order_id: editingOrder.id,
      p_shop_id: isDelivery ? null : editOrderShop.value,
      p_fulfillment: editOrderFulfillment.value,
      p_delivery_area: isDelivery ? editOrderDeliveryArea.value : null,
      p_delivery_address: isDelivery ? editOrderDeliveryAddress.value.trim() : null,
      p_items: items,
    });
    if (error) throw error;

    editOrderDialog.close();
    await loadOrders(true);
    if (!ordersMessage.classList.contains("is-error")) {
      setOrdersMessage("Your order changes were saved and the total was recalculated.");
    }
  } catch (error) {
    setInlineMessage(editOrderMessage, `Could not save your order changes: ${error.message}`, true);
    if (error.message.includes("Only pending orders can be edited")) {
      editOrderDialog.close();
      await loadOrders(true);
      setOrdersMessage(error.message, true);
    }
  } finally {
    setBusy(editOrderForm, false);
  }
});

document.querySelector("#close-edit-order").addEventListener("click", () => editOrderDialog.close());
document.querySelector("#keep-order-button").addEventListener("click", () => editOrderDialog.close());
editOrderDialog.addEventListener("close", () => {
  editingOrder = null;
  editOrderForm.reset();
  editOrderMessage.textContent = "";
  editOrderMessage.classList.remove("is-error");
});
editOrderFulfillment.addEventListener("change", updateEditOrderFields);
editOrderDeliveryArea.addEventListener("change", updateEditOrderFields);
Object.values(editOrderQuantities).forEach((input) => {
  input.addEventListener("input", updateEditOrderFields);
});

loadMoreButton.addEventListener("click", () => loadOrders());
["#filter-start", "#filter-end", "#filter-flavor", "#order-sort"].forEach((selector) => {
  document.querySelector(selector).addEventListener("change", renderOrders);
});

const menuToggle = document.querySelector(".menu-toggle");
const navMenu = document.querySelector("#primary-menu");
menuToggle.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Open navigation menu" : "Close navigation menu");
  navMenu.classList.toggle("is-open", !isOpen);
  document.body.classList.toggle("menu-open", !isOpen);
});
navMenu.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation menu");
    navMenu.classList.remove("is-open");
    document.body.classList.remove("menu-open");
  });
});
window.addEventListener("scroll", () => {
  document.querySelector(".site-header").classList.toggle("is-scrolled", window.scrollY > 12);
}, { passive: true });
document.querySelector("#current-year").textContent = String(new Date().getFullYear());

if (!backend?.configured) {
  showMessage("Accounts and order tracking are not active yet. Follow the Supabase setup instructions and add the project URL and public anon key to supabase-config.js.", true);
  signupForm.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
  loginForm.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
} else {
  try {
    renderRememberedPhones();
  } catch (error) {
    showMessage(error.message, true);
  }
  backend.client.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    return showSignedInAccount(data.session);
  }).catch((error) => {
    showMessage(`Could not initialize your account: ${error.message}`, true);
  });
  backend.client.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
  });
}

const WHATSAPP_NUMBER = "233246344188";
const shopSelect = document.querySelector("#shop-select");
const pickupShopField = document.querySelector("#pickup-shop-field");
const deliveryDetails = document.querySelector("#delivery-details");
const deliveryArea = document.querySelector("#delivery-area");
const deliveryLocation = document.querySelector("#delivery-location");
const useLocationButton = document.querySelector("#use-location");
const locationStatus = document.querySelector("#location-status");
const orderSummary = document.querySelector("#order-summary");
const orderSelected = document.querySelector("#order-selected");
const orderAccountStatus = document.querySelector("#order-account-status");
const orderBillItems = document.querySelector("#order-bill-items");
const orderSubtotal = document.querySelector("#order-subtotal");
const orderDeliveryFee = document.querySelector("#order-delivery-fee");
const orderTotal = document.querySelector("#order-total");
const orderBillNote = document.querySelector("#order-bill-note");
const menuToggle = document.querySelector(".menu-toggle");
const navMenu = document.querySelector("#primary-menu");
const siteHeader = document.querySelector(".site-header");
const backend = window.coconibzBackend;
const PENDING_ORDER_KEY = "coconibz-pending-order";
let currentSession = null;
let orderSubmissionInProgress = false;

function formatGhs(amount) {
  return `GHS ${amount}`;
}

function makeWhatsAppUrl(message, number = WHATSAPP_NUMBER) {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function getSelectedItems() {
  return [...document.querySelectorAll(".product-card[data-order-product]")]
    .map((card) => ({
      flavor: card.dataset.orderProduct,
      productKey: card.dataset.productKey,
      quantity: Number(card.querySelector("[data-flavor-quantity]").value),
      unitPrice: Number(card.dataset.price),
    }))
    .filter((item) => item.quantity > 0);
}

function savePendingOrder() {
  const items = getSelectedItems().map(({ productKey, quantity }) => ({ productKey, quantity }));
  const fulfillment = document.querySelector('input[name="fulfillment"]:checked').value;
  sessionStorage.setItem(PENDING_ORDER_KEY, JSON.stringify({
    items,
    fulfillment,
    shopId: shopSelect.selectedOptions[0]?.dataset.shopId || null,
    deliveryArea: deliveryArea.value || null,
    deliveryAddress: deliveryLocation.value.trim(),
  }));
}

function restorePendingOrder() {
  const serializedOrder = sessionStorage.getItem(PENDING_ORDER_KEY);
  if (!serializedOrder) {
    return;
  }

  try {
    const order = JSON.parse(serializedOrder);
    if (!Array.isArray(order.items)) {
      throw new Error("Saved order is invalid.");
    }
    order.items.forEach(({ productKey, quantity }) => {
      const card = document.querySelector(`.product-card[data-product-key="${productKey}"]`);
      const output = card?.querySelector("[data-flavor-quantity]");
      if (output && Number.isInteger(quantity) && quantity >= 0 && quantity <= 20) {
        output.value = String(quantity);
        output.textContent = String(quantity);
      }
    });
    if (order.fulfillment === "delivery" || order.fulfillment === "pickup") {
      document.querySelector(`input[name="fulfillment"][value="${order.fulfillment}"]`).checked = true;
    }
    if (order.shopId) {
      shopSelect.value = [...shopSelect.options].find((option) => option.dataset.shopId === order.shopId)?.value || "Any shop";
    }
    if (typeof order.deliveryArea === "string") {
      deliveryArea.value = order.deliveryArea;
    }
    if (typeof order.deliveryAddress === "string") {
      deliveryLocation.value = order.deliveryAddress;
    }
  } catch (error) {
    sessionStorage.removeItem(PENDING_ORDER_KEY);
    orderAccountStatus.textContent = `Could not restore your saved order: ${error.message}`;
  }
}

function updateOrderAccountStatus() {
  if (!backend?.configured) {
    orderAccountStatus.textContent = "Order tracking is not connected yet. Complete the Supabase setup to save and track orders.";
    return;
  }
  orderAccountStatus.textContent = currentSession
    ? "Signed in. Your order will be saved to My Orders before WhatsApp opens."
    : "Sign in or join to save and track your order.";
}

function updateWhatsAppLinks() {
  document.querySelectorAll('[data-whatsapp="general"]').forEach((link) => {
    link.href = makeWhatsAppUrl("Hello COCONIBZ, I would like to know more about your coconut drinks. Please share the details.");
  });
}

function updateCombinedOrder() {
  const selectedItems = getSelectedItems();
  savePendingOrder();

  const totalQuantity = selectedItems.reduce((total, item) => total + item.quantity, 0);
  const subtotal = selectedItems.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
  const fulfillment = document.querySelector('input[name="fulfillment"]:checked').value;
  const isDelivery = fulfillment === "delivery";
  const pickupNumber = shopSelect.selectedOptions[0]?.dataset.whatsapp || WHATSAPP_NUMBER;
  const pickupReady = isDelivery || Boolean(shopSelect.selectedOptions[0]?.dataset.shopId);
  const selectedArea = deliveryArea.selectedOptions[0];
  const deliveryFee = Number(selectedArea?.dataset.fee || 0);
  const deliveryAddress = deliveryLocation.value.trim();
  const deliveryReady = !isDelivery || Boolean(deliveryArea.value && deliveryAddress);
  const hasItems = selectedItems.length > 0 && deliveryReady && pickupReady;

  orderBillItems.replaceChildren();
  if (!selectedItems.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "order-bill-empty";
    emptyItem.textContent = "Choose quantities to preview your bill.";
    orderBillItems.append(emptyItem);
  } else {
    selectedItems.forEach((item) => {
      const row = document.createElement("li");
      const description = document.createElement("span");
      const amount = document.createElement("strong");
      description.textContent = `${item.flavor} × ${item.quantity}`;
      amount.textContent = formatGhs(item.quantity * item.unitPrice);
      row.append(description, amount);
      orderBillItems.append(row);
    });
  }

  orderSubtotal.textContent = formatGhs(subtotal);
  orderDeliveryFee.textContent = isDelivery && !deliveryArea.value ? "Choose area" : formatGhs(isDelivery ? deliveryFee : 0);
  orderTotal.textContent = isDelivery && !deliveryArea.value
    ? "Choose area"
    : formatGhs(subtotal + (isDelivery ? deliveryFee : 0));
  orderBillNote.textContent = !selectedItems.length
    ? "Choose quantities to preview your bill."
    : isDelivery && !deliveryArea.value
      ? "Choose a delivery area to see the delivery fee and total."
      : isDelivery && !deliveryAddress
        ? "Add your delivery location before placing your order."
        : isDelivery
          ? "Delivery fee is included for your selected area."
          : "Pickup selected. No delivery fee.";

  if (!selectedItems.length) {
    orderSummary.textContent = "Choose a quantity for each flavor you want.";
  } else if (!pickupReady) {
    orderSummary.textContent = "Choose a pickup shop so your order is sent to the right location.";
  } else if (!deliveryReady) {
    orderSummary.textContent = "Choose a delivery area and enter your delivery location.";
  } else {
    const selection = `${selectedItems.length} flavor${selectedItems.length === 1 ? "" : "s"} · ${totalQuantity} bottle${totalQuantity === 1 ? "" : "s"} selected.`;
    orderSummary.textContent = fulfillment === "delivery" ? `${selection} Delivery fee: GHS ${deliveryFee}.` : selection;
  }

  orderSelected.setAttribute("aria-disabled", String(!hasItems));
  orderSelected.tabIndex = hasItems ? 0 : -1;
  orderSelected.classList.toggle("is-disabled", !hasItems);
  orderSelected.classList.toggle("is-submitting", orderSubmissionInProgress);
  orderSelected.setAttribute("aria-busy", String(orderSubmissionInProgress));

  if (!hasItems) {
    orderSelected.href = "#";
    return;
  }

  const itemLines = selectedItems
    .map((item) => `- ${item.flavor} x ${item.quantity} @ ${formatGhs(item.unitPrice)} each = ${formatGhs(item.quantity * item.unitPrice)}`)
    .join("\n");
  const serviceLines = isDelivery
    ? `Service: Delivery.\nArea: ${deliveryArea.value}.\nDelivery location: ${deliveryAddress}.\nDelivery fee: ${formatGhs(deliveryFee)}.\nTotal: ${formatGhs(subtotal + deliveryFee)}.`
    : `Service: Pickup.\nPickup shop: ${shopSelect.value}.`;
  const message = `Hello COCONIBZ, I would like to order:\n${itemLines}\nSubtotal: ${formatGhs(subtotal)}.\n${serviceLines}${isDelivery ? "" : `\nTotal: ${formatGhs(subtotal)}.`}\nPlease confirm availability.`;
  orderSelected.href = makeWhatsAppUrl(message, isDelivery ? WHATSAPP_NUMBER : pickupNumber);
}

function updateFulfillmentFields() {
  const isDelivery = document.querySelector('input[name="fulfillment"]:checked').value === "delivery";
  pickupShopField.hidden = isDelivery;
  deliveryDetails.hidden = !isDelivery;
  updateCombinedOrder();
}

orderSelected.addEventListener("click", async (event) => {
  event.preventDefault();
  if (orderSelected.getAttribute("aria-disabled") === "true") {
    return;
  }
  if (orderSubmissionInProgress) return;
  if (!backend?.configured) {
    orderSummary.textContent = "Order tracking is not set up yet. Please contact COCONIBZ on WhatsApp while the account system is configured.";
    return;
  }
  if (!currentSession) {
    savePendingOrder();
    window.location.href = `account.html?next=${encodeURIComponent("index.html?resumeOrder=1#flavors")}`;
    return;
  }

  orderSubmissionInProgress = true;
  orderSelected.setAttribute("aria-disabled", "true");
  orderSelected.tabIndex = -1;
  orderSummary.textContent = "Saving your order securely...";
  const items = getSelectedItems();
  const fulfillment = document.querySelector('input[name="fulfillment"]:checked').value;
  const isDelivery = fulfillment === "delivery";
  const deliveryFee = Number(deliveryArea.selectedOptions[0]?.dataset.fee || 0);
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const shopId = isDelivery ? null : shopSelect.selectedOptions[0]?.dataset.shopId || null;
  const pickupNumber = shopSelect.selectedOptions[0]?.dataset.whatsapp || WHATSAPP_NUMBER;
  const itemLines = items
    .map((item) => `- ${item.flavor} x ${item.quantity} @ ${formatGhs(item.unitPrice)} each = ${formatGhs(item.quantity * item.unitPrice)}`)
    .join("\n");
  const serviceLines = isDelivery
    ? `Service: Delivery.\nArea: ${deliveryArea.value}.\nDelivery location: ${deliveryLocation.value.trim()}.\nDelivery fee: ${formatGhs(deliveryFee)}.\nTotal: ${formatGhs(subtotal + deliveryFee)}.`
    : `Service: Pickup.\nPickup shop: ${shopSelect.value}.\nTotal: ${formatGhs(subtotal)}.`;
  const message = `Hello COCONIBZ, I would like to order:\n${itemLines}\nSubtotal: ${formatGhs(subtotal)}.\n${serviceLines}\nPlease confirm availability.`;

  try {
    const { error } = await backend.client.rpc("place_coconibz_order", {
      p_shop_id: shopId,
      p_fulfillment: fulfillment,
      p_delivery_area: isDelivery ? deliveryArea.value : null,
      p_delivery_address: isDelivery ? deliveryLocation.value.trim() : null,
      p_items: items.map(({ productKey, quantity }) => ({ product_key: productKey, quantity })),
    });
    if (error) throw error;
    sessionStorage.removeItem(PENDING_ORDER_KEY);
    window.location.assign(makeWhatsAppUrl(message, isDelivery ? WHATSAPP_NUMBER : pickupNumber));
  } catch (error) {
    orderSubmissionInProgress = false;
    updateCombinedOrder();
    orderSummary.textContent = `Could not save your order, so WhatsApp was not opened. ${error.message}`;
  }
});

document.querySelectorAll("[data-mix-change]").forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".product-card");
    const quantityOutput = card.querySelector("[data-flavor-quantity]");
    const nextQuantity = Math.max(0, Math.min(20, Number(quantityOutput.value) + Number(button.dataset.mixChange)));
    quantityOutput.value = String(nextQuantity);
    quantityOutput.textContent = String(nextQuantity);
    updateCombinedOrder();
  });
});
shopSelect.addEventListener("change", updateCombinedOrder);
document.querySelectorAll('input[name="fulfillment"]').forEach((input) => {
  input.addEventListener("change", updateFulfillmentFields);
});
deliveryArea.addEventListener("change", updateCombinedOrder);
deliveryLocation.addEventListener("input", updateCombinedOrder);

useLocationButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    locationStatus.textContent = "Location is unavailable here. Enter your address or a nearby landmark.";
    return;
  }

  useLocationButton.disabled = true;
  locationStatus.textContent = "Getting your location...";
  navigator.geolocation.getCurrentPosition((position) => {
    deliveryLocation.value = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
    locationStatus.textContent = "Location added. Add a nearby landmark if helpful.";
    useLocationButton.disabled = false;
    updateCombinedOrder();
  }, () => {
    locationStatus.textContent = "Could not get your location. Enter your address or a nearby landmark.";
    useLocationButton.disabled = false;
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
});
document.querySelectorAll(".location-card").forEach((card) => {
  const shopName = card.querySelector("h3").textContent.trim();
  const address = card.querySelector("[data-shop-address]").dataset.shopAddress.trim();
  const shopValue = address ? `${shopName} - ${address}` : shopName;
  const option = document.createElement("option");
  option.value = shopValue;
  option.textContent = shopName;
  option.dataset.shopId = card.dataset.shopId;
  const shopWhatsAppNumber = card.querySelector(".shop-whatsapp")?.href.match(/wa\.me\/(\d+)/)?.[1];
  if (shopWhatsAppNumber) {
    option.dataset.whatsapp = shopWhatsAppNumber;
  }
  shopSelect.append(option);

  const directionsLink = card.querySelector(".directions-link");
  const mapQuery = address ? `${shopName}, ${address}` : shopName;
  directionsLink.href = card.dataset.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
});

restorePendingOrder();
updateWhatsAppLinks();
updateFulfillmentFields();
updateCombinedOrder();

if (backend?.configured) {
  backend.client.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    currentSession = data.session;
    updateOrderAccountStatus();
  }).catch((error) => {
    orderAccountStatus.textContent = `Could not check your sign-in status: ${error.message}`;
  });
  backend.client.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    updateOrderAccountStatus();
  });
} else {
  updateOrderAccountStatus();
}

document.querySelectorAll(".footer-contact [data-whatsapp='general']").forEach((link) => {
  link.href = makeWhatsAppUrl("Hello COCONIBZ, I would like to get in touch. Please share the details.");
});

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
window.addEventListener("scroll", () => siteHeader.classList.toggle("is-scrolled", window.scrollY > 12), { passive: true });
document.querySelector("#current-year").textContent = String(new Date().getFullYear());

const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}
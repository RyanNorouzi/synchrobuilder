// Formatting helpers. The real file name is lower-case; src/index.js imports it as Helper.js.
export function formatOrder(order) {
  return `#${order.id} ${Number(order.total).toFixed(2)}`;
}

export async function invokeEdgeFunction(client, functionName, body) {
  const { data, error } = await client.functions.invoke(functionName, { body });
  if (!error) return data;

  let message = error.message || "The server request failed.";
  if (error.context instanceof Response) {
    const responseText = await error.context.clone().text();
    if (responseText) {
      try {
        const details = JSON.parse(responseText);
        if (typeof details.error === "string") message = details.error;
      } catch (parseError) {
        if (!(parseError instanceof SyntaxError)) throw parseError;
      }
    }
  }
  throw new Error(message);
}

const { getInternalConfig } = require("../services/configService");
const { sendSuccess } = require("../utils/apiResponse");

async function getConfig(req, res) {
  const config = await getInternalConfig();
  return sendSuccess(res, config);
}

module.exports = {
  getConfig,
};

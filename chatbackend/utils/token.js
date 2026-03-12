const jwt = require('jsonwebtoken')

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'dev_secret_change_me', {
    expiresIn: '7d',
  })
}

module.exports = {
  signToken,
}

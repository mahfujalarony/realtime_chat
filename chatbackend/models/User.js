const bcrypt = require('bcryptjs')

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
          len: [3, 50],
        },
      },
      uniqueUsername: {
        type: DataTypes.STRING(120),
        allowNull: true,
        unique: true,
      },
      email: {
        type: DataTypes.STRING(120),
        allowNull: true,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      mobileNumber: {
        type: DataTypes.STRING(20),
        allowNull: true,
        unique: true,
      },
      dateOfBirth: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      failedLoginAttempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      loginLockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastSeen: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      profileMediaUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      profileNote: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      role: {
        type: DataTypes.ENUM('user', 'model_admin', 'admin'),
        allowNull: false,
        defaultValue: 'user',
        validate: {
          isIn: [['user', 'model_admin', 'admin']],
        },
      },
      canHandleExternalChat: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      canDownloadConversations: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      canEditConversationNote: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      canBlockUsers: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: 'users',
      underscored: true,
      defaultScope: {
        attributes: { exclude: ['passwordHash', 'failedLoginAttempts', 'loginLockedUntil'] },
      },
      scopes: {
        withPassword: {
          attributes: { include: ['passwordHash', 'failedLoginAttempts', 'loginLockedUntil'] },
        },
      },
    },
  )

  User.prototype.comparePassword = function comparePassword(password) {
    return bcrypt.compare(password, this.passwordHash)
  }

  User.addHook('beforeCreate', async (user) => {
    if (user.passwordHash) {
      user.passwordHash = await bcrypt.hash(user.passwordHash, 10)
    }
  })

  User.addHook('beforeUpdate', async (user) => {
    if (user.changed('passwordHash')) {
      user.passwordHash = await bcrypt.hash(user.passwordHash, 10)
    }
  })

  return User
}

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
        unique: true,
        validate: {
          len: [3, 50],
        },
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
      lastSeen: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      profileMediaUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: 'users',
      underscored: true,
      defaultScope: {
        attributes: { exclude: ['passwordHash'] },
      },
      scopes: {
        withPassword: {
          attributes: { include: ['passwordHash'] },
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

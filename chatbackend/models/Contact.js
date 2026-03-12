module.exports = (sequelize, DataTypes) => {
  const Contact = sequelize.define(
    'Contact',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      contactUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: 'contacts',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['user_id', 'contact_user_id'],
        },
      ],
    },
  )

  return Contact
}
